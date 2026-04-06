package expo.modules.httpserver

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class ExpoHttpServerModule : Module() {
    private var serverSocket: ServerSocket? = null
    private var serverThread: Thread? = null
    private var executor: ExecutorService? = null
    private data class PendingRequest(val socket: Socket, val origin: String?)
    private val pendingRequests = ConcurrentHashMap<String, PendingRequest>()
    @Volatile
    private var running = false

    override fun definition() = ModuleDefinition {
        Name("ExpoHttpServer")

        Events("onRequest")

        AsyncFunction("start") { port: Int, host: String ->
            if (running) return@AsyncFunction

            running = true
            executor = Executors.newCachedThreadPool()

            val ss = ServerSocket()
            ss.reuseAddress = true
            ss.bind(InetSocketAddress(InetAddress.getByName(host), port), 50)
            serverSocket = ss

            serverThread = Thread {
                while (running) {
                    try {
                        val socket = serverSocket?.accept() ?: break
                        executor?.submit { handleConnection(socket) }
                    } catch (e: Exception) {
                        if (running) {
                            android.util.Log.w("ExpoHttpServer", "Accept error: ${e.message}")
                        }
                    }
                }
            }
            serverThread?.isDaemon = true
            serverThread?.name = "ExpoHttpServer-accept"
            serverThread?.start()

            android.util.Log.i("ExpoHttpServer", "Listening on $host:$port")
        }

        Function("respond") { requestId: String, statusCode: Int, headers: Map<String, String>, body: String ->
            // Run socket write on executor to avoid blocking JS thread
            executor?.submit {
                val pending = pendingRequests.remove(requestId) ?: return@submit
                val socket = pending.socket
                try {
                    val output = socket.getOutputStream()
                    val statusText = when (statusCode) {
                        200 -> "OK"
                        204 -> "No Content"
                        400 -> "Bad Request"
                        401 -> "Unauthorized"
                        404 -> "Not Found"
                        413 -> "Payload Too Large"
                        500 -> "Internal Server Error"
                        else -> "OK"
                    }

                    val sb = StringBuilder()
                    sb.append("HTTP/1.1 $statusCode $statusText\r\n")
                    // CORS: only allow trusted local origins instead of wildcard
                    val allowedOrigins = setOf(
                        "http://localhost",
                        "http://127.0.0.1",
                        "https://localhost",
                        "https://127.0.0.1"
                    )
                    val requestOrigin = pending.origin
                    val corsOrigin = if (requestOrigin != null && allowedOrigins.any { requestOrigin.startsWith(it) }) {
                        requestOrigin
                    } else {
                        "http://localhost"
                    }
                    sb.append("Access-Control-Allow-Origin: $corsOrigin\r\n")
                    sb.append("Vary: Origin\r\n")
                    sb.append("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n")
                    sb.append("Access-Control-Allow-Headers: Content-Type, Authorization, X-OAuthHub-Signature\r\n")

                    for ((key, value) in headers) {
                        sb.append("$key: $value\r\n")
                    }

                    if (statusCode != 204) {
                        val bodyBytes = body.toByteArray(Charsets.UTF_8)
                        sb.append("Content-Type: application/json\r\n")
                        sb.append("Content-Length: ${bodyBytes.size}\r\n")
                    }

                    sb.append("Connection: close\r\n")
                    sb.append("\r\n")

                    if (statusCode != 204) {
                        sb.append(body)
                    }

                    output.write(sb.toString().toByteArray(Charsets.UTF_8))
                    output.flush()
                } catch (e: Exception) {
                    android.util.Log.w("ExpoHttpServer", "Respond error: ${e.message}")
                } finally {
                    try { socket.close() } catch (_: Exception) {}
                }
            }
        }

        AsyncFunction("startForegroundService") {
            val context = appContext.reactContext
                ?: throw Exception("React context not available")
            val intent = Intent(context, HttpServerForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            android.util.Log.i("ExpoHttpServer", "Foreground service started")
        }

        AsyncFunction("stopForegroundService") {
            val context = appContext.reactContext
                ?: throw Exception("React context not available")
            val intent = Intent(context, HttpServerForegroundService::class.java)
            context.stopService(intent)
            android.util.Log.i("ExpoHttpServer", "Foreground service stopped")
        }

        AsyncFunction("stop") {
            running = false
            try { serverSocket?.close() } catch (_: Exception) {}
            executor?.shutdownNow()
            serverSocket = null
            serverThread = null
            executor = null
            for (entry in pendingRequests) {
                try { entry.value.socket.close() } catch (_: Exception) {}
            }
            pendingRequests.clear()
            android.util.Log.i("ExpoHttpServer", "Server stopped")
        }
    }

    private fun handleConnection(socket: Socket) {
        try {
            socket.soTimeout = 30000
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))

            // Read request line
            val requestLine = reader.readLine() ?: return
            val parts = requestLine.split(" ", limit = 3)
            if (parts.size < 2) return
            val method = parts[0]
            val path = parts[1].split("?")[0]

            // Read headers
            val headers = mutableMapOf<String, String>()
            var contentLength = 0
            var line = reader.readLine()
            while (line != null && line.isNotEmpty()) {
                val colonIndex = line.indexOf(":")
                if (colonIndex > 0) {
                    val key = line.substring(0, colonIndex).trim().lowercase()
                    val value = line.substring(colonIndex + 1).trim()
                    headers[key] = value
                    if (key == "content-length") {
                        contentLength = value.toIntOrNull() ?: 0
                    }
                }
                line = reader.readLine()
            }

            // Read body
            var body = ""
            if (contentLength > 0 && contentLength <= 1048576) { // 1MB limit
                val chars = CharArray(contentLength)
                var read = 0
                while (read < contentLength) {
                    val n = reader.read(chars, read, contentLength - read)
                    if (n == -1) break
                    read += n
                }
                body = String(chars, 0, read)
            }

            // Store socket and origin for later response
            val requestId = UUID.randomUUID().toString()
            val origin = headers["origin"]
            pendingRequests[requestId] = PendingRequest(socket, origin)

            // Send event to JS
            this@ExpoHttpServerModule.sendEvent("onRequest", mapOf(
                "requestId" to requestId,
                "method" to method,
                "path" to path,
                "headers" to headers,
                "body" to body
            ))

            // Clean up stale requests older than 60 seconds
            // (in case JS never responds)
            val now = System.currentTimeMillis()
            // Simple approach: just let socket timeout handle it
        } catch (e: Exception) {
            android.util.Log.w("ExpoHttpServer", "Connection error: ${e.message}")
            try { socket.close() } catch (_: Exception) {}
        }
    }
}
