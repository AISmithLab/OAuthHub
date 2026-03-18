import React from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import LogsPanel from './components/LogsPanel';
import ManifestsPanel from './components/ManifestsPanel';
import ServicesPanel from './components/ServicesPanel';
import ConsentWindow from './components/ConsentWindow';
import ManifestIDE from './components/ManifestIDE';

// Helper to determine if we're in the consent window
const isConsentWindow = () => {
  return window.location.pathname === '/authorize';
};

const AuthorizeRoute = () => {
  const location = useLocation();
  const params = location.state || {};

  // If no state is present in location, try to get from URL search params
  if (!params.provider || !params.redirectUri || !params.state) {
    const searchParams = new URLSearchParams(window.location.hash.split('?')[1]);
    params.provider = params.provider || searchParams.get('provider');
    params.manifest = params.manifest || searchParams.get('manifest');
    params.redirectUri = params.redirectUri || searchParams.get('redirect_uri');
    params.state = params.state || searchParams.get('state');
    params.accessType = params.accessType || searchParams.get('access_type');
    params.schedule = params.schedule || searchParams.get('schedule');
    params.codeChallenge = params.codeChallenge || searchParams.get('code_challenge');
  }

  return (
    <ConsentWindow
      provider={params.provider}
      redirectUri={params.redirectUri}
      state={params.state}
      manifest={params.manifest}
      accessType={params.accessType}
      schedule={params.schedule}
      codeChallenge={params.codeChallenge}
    />
  );
};

const App = () => {
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    const messageListener = (message, sender) => {
      if (message.type === 'AUTH_REQUEST') {
        // Security: Only accept AUTH_REQUEST from our own extension's background script
        if (sender.id !== chrome.runtime.id) {
          console.error('SECURITY: Rejected AUTH_REQUEST from unauthorized sender:', sender.id);
          return;
        }
        // Background scripts don't have tabs - reject if sender has a tab context
        if (sender.tab) {
          console.error('SECURITY: Rejected AUTH_REQUEST from tab context (expected background)');
          return;
        }

        if (isConsentWindow()) {
          navigate('/authorize', {
            state: {
              provider: message.params.provider,
              redirectUri: message.params.redirect_uri,
              state: message.params.state,
              manifest: message.params.manifest,
              accessType: message.params.access_type,
              schedule: message.params.schedule,
              codeChallenge: message.params.code_challenge
            }
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [navigate]);

  // Render different routes based on path
  if (isConsentWindow()) {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-gray-100 w-full h-screen">
        <Routes>
          <Route path="/authorize" element={<AuthorizeRoute />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-50 to-gray-100 w-full h-screen">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/manifests" element={<ManifestsPanel />} />
        <Route path="/services" element={<ServicesPanel />} />
        <Route path="/logs" element={<LogsPanel />} />
        <Route path="/ide" element={<ManifestIDE />} />
        <Route path="/authorize" element={<AuthorizeRoute />} />
      </Routes>
    </div>
  );
};

export default App;
