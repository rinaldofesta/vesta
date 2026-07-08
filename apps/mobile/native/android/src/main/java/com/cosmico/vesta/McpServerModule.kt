package com.cosmico.vesta

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import fi.iki.elonen.NanoHTTPD
import java.net.Inet4Address
import java.net.NetworkInterface

class McpServerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "McpServerModule"

    @Volatile private var activeTokens: Set<String> = emptySet()
    private var server: McpHttpServer? = null

    @ReactMethod
    fun setActiveTokens(tokens: ReadableArray) {
        val set = HashSet<String>()
        for (i in 0 until tokens.size()) tokens.getString(i)?.let { set.add(it) }
        activeTokens = set
    }

    @ReactMethod
    fun startServer(port: Int, promise: Promise) {
        try {
            if (server != null) { promise.resolve(lanIp()); return }
            val s = McpHttpServer(port, { activeTokens }, ::emitRequest)
            s.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            server = s
            promise.resolve(lanIp())
        } catch (e: Exception) {
            promise.reject("MCP_START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopServer(promise: Promise) {
        server?.stop()
        server = null
        promise.resolve(null)
    }

    @ReactMethod
    fun respondMcp(id: String, status: Int, body: String) {
        server?.complete(id, status, body)
    }

    // NativeEventEmitter contract.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    private fun emitRequest(id: String, token: String, body: String) {
        if (!reactApplicationContext.hasActiveReactInstance()) return
        val map = com.facebook.react.bridge.Arguments.createMap()
        map.putString("id", id)
        map.putString("token", token)
        map.putString("body", body)
        reactApplicationContext.emitDeviceEvent("mcpRequest", map)
    }

    private fun lanIp(): String {
        for (nif in NetworkInterface.getNetworkInterfaces()) {
            if (!nif.isUp || nif.isLoopback) continue
            for (addr in nif.inetAddresses) {
                if (addr is Inet4Address && !addr.isLoopbackAddress) return addr.hostAddress ?: ""
            }
        }
        return ""
    }
}
