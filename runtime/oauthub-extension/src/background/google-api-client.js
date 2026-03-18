/**
 * Google API Client with OAuth 2.1 Security Features
 * Provides secure token management and API request helpers for OAuthHub
 */

class GoogleAPIClient {
  constructor() {
    this.baseUrls = {
      gmail: 'https://gmail.googleapis.com/gmail/v1',
      calendar: 'https://www.googleapis.com/calendar/v3',
      drive: 'https://www.googleapis.com/drive/v3',
      forms: 'https://forms.googleapis.com/v1'
    };
  }

  /**
   * Request Google authorization for required scopes
   * Uses OAuth 2.1 with PKCE, state, nonce, and optional DPoP
   */
  async authorize(requiredScopes, options = {}) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'INITIATE_GOOGLE_OAUTH',
        data: {
          requiredScopes: Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes],
          useDPoP: options.useDPoP || false
        }
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      if (response.data.existing) {
        return response.data.token;
      }

      // Authorization window opened, return authorization details
      return {
        authUrl: response.data.authUrl,
        sessionId: response.data.sessionId,
        tabId: response.data.tabId,
        pending: true
      };
    } catch (error) {
      throw new Error(`Google authorization failed: ${error.message}`);
    }
  }

  /**
   * Get valid Google access token with automatic refresh
   * Includes DPoP proof generation for secure API requests
   */
  async getAccessToken(requiredScopes, targetUrl = null, method = 'GET') {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_GOOGLE_TOKEN',
        data: {
          requiredScopes: Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes],
          targetUrl,
          method
        }
      });

      if (!response.success) {
        if (response.needsAuth) {
          throw new Error('REAUTHORIZATION_REQUIRED');
        }
        throw new Error(response.error);
      }

      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Make authenticated API request to Google with security measures
   * Handles token refresh, DPoP proofs, and error handling
   */
  async makeRequest(url, options = {}) {
    const {
      method = 'GET',
      headers = {},
      body,
      requiredScopes,
      maxRetries = 2
    } = options;

    if (!requiredScopes) {
      throw new Error('Required scopes must be specified for API requests');
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        // Get valid token with DPoP proof if needed
        const tokenData = await this.getAccessToken(requiredScopes, url, method);
        
        // Prepare request headers
        const requestHeaders = {
          'Accept': 'application/json',
          ...headers
        };

        // Add authorization header
        if (tokenData.token_type === 'DPoP' && tokenData.dpop_proof) {
          requestHeaders['Authorization'] = `DPoP ${tokenData.access_token}`;
          requestHeaders['DPoP'] = tokenData.dpop_proof;
        } else {
          requestHeaders['Authorization'] = `Bearer ${tokenData.access_token}`;
        }

        // Add content type for POST/PUT/PATCH
        if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && !requestHeaders['Content-Type']) {
          requestHeaders['Content-Type'] = 'application/json';
        }

        // Make the API request
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
        });

        // Handle different response scenarios
        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            return await response.json();
          } else {
            return await response.text();
          }
        }

        // Handle 401 Unauthorized - token may need refresh
        if (response.status === 401 && attempt < maxRetries) {
          console.warn('API request returned 401, attempting token refresh...');
          attempt++;
          continue; // Retry with fresh token
        }

        // Handle other HTTP errors
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);

      } catch (error) {
        if (error.message === 'REAUTHORIZATION_REQUIRED' && attempt < maxRetries) {
          // Need user reauthorization (DPoP state is unknown here since tokenData is out of scope)
          const authResult = await this.authorize(requiredScopes);
          if (authResult.pending) {
            throw new Error('User authorization required - please complete the authorization flow');
          }
          attempt++;
          continue;
        }

        if (attempt >= maxRetries) {
          throw error;
        }

        attempt++;
      }
    }
  }

  /**
   * Gmail API helpers with OAuth 2.1 security
   */
  async gmail(endpoint, options = {}) {
    const scopes = options.write ? 
      ['https://www.googleapis.com/auth/gmail.send'] : 
      ['https://www.googleapis.com/auth/gmail.readonly'];

    return this.makeRequest(`${this.baseUrls.gmail}${endpoint}`, {
      ...options,
      requiredScopes: scopes
    });
  }

  /**
   * Google Calendar API helpers with OAuth 2.1 security
   */
  async calendar(endpoint, options = {}) {
    const scopes = options.write ? 
      ['https://www.googleapis.com/auth/calendar.events'] : 
      ['https://www.googleapis.com/auth/calendar.events.readonly'];

    return this.makeRequest(`${this.baseUrls.calendar}${endpoint}`, {
      ...options,
      requiredScopes: scopes
    });
  }

  /**
   * Google Drive API helpers with OAuth 2.1 security
   */
  async drive(endpoint, options = {}) {
    const scopes = options.write ? 
      ['https://www.googleapis.com/auth/drive'] : 
      ['https://www.googleapis.com/auth/drive.readonly'];

    return this.makeRequest(`${this.baseUrls.drive}${endpoint}`, {
      ...options,
      requiredScopes: scopes
    });
  }

  /**
   * Google Forms API helpers with OAuth 2.1 security
   */
  async forms(endpoint, options = {}) {
    const scopes = options.write ? 
      ['https://www.googleapis.com/auth/forms.body'] : 
      ['https://www.googleapis.com/auth/forms.responses.readonly'];

    return this.makeRequest(`${this.baseUrls.forms}${endpoint}`, {
      ...options,
      requiredScopes: scopes
    });
  }

  /**
   * Batch requests with consistent security handling
   */
  async batch(requests) {
    const results = [];
    
    for (const request of requests) {
      try {
        const result = await this.makeRequest(request.url, request.options);
        results.push({ success: true, data: result });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Check current authorization status
   */
  async getAuthorizationStatus(requiredScopes) {
    try {
      const tokenData = await this.getAccessToken(requiredScopes);
      return {
        authorized: true,
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        dpop_enabled: !!tokenData.dpop_proof
      };
    } catch (error) {
      return {
        authorized: false,
        error: error.message,
        needs_auth: error.message === 'REAUTHORIZATION_REQUIRED'
      };
    }
  }

  /**
   * Revoke authorization and clear stored tokens
   */
  async revokeAuthorization() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REVOKE_GOOGLE_TOKEN'
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      return true;
    } catch (error) {
      throw new Error(`Failed to revoke authorization: ${error.message}`);
    }
  }
}

// Export singleton instance
const googleAPIClient = new GoogleAPIClient();
export default googleAPIClient;
