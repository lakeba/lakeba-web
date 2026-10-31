package com.lakeba.crm

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout

/**
 * Lakeba CRM on the salesperson's phone: the portal's CRM (/admin/crm) in an app. What the app adds to a
 * browser: the prompt after a business call (CallReceiver), the microphone for voice notes and the camera
 * for business cards, both for the portal only. Everything else is the portal's: sign-in, two-step, the
 * pages. A long press on the app's title bar area isn't needed: the settings open from the CRM's own menu
 * ("App settings" link) or by opening the app with the portal unreachable.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var pendingMic: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val prefs by lazy { getSharedPreferences("crm", Context.MODE_PRIVATE) }
    /** The portal's address, or a venture's CRM address (crm.doxai.com). */
    private val portal: String
        get() = (prefs.getString("portal", null) ?: BuildConfig.PORTAL).trimEnd('/')

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) intent?.getStringExtra("portal")?.let { prefs.edit().putString("portal", it).apply() }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#050B16"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.userAgentString = "${settings.userAgentString} LakebaCRM/${BuildConfig.VERSION_NAME}"
            webViewClient = PortalClient()
            webChromeClient = Chrome()
        }
        CookieManager.getInstance().setAcceptCookie(true)
        setContentView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        askPermissions()
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else open(intent?.getStringExtra("path"))
        if (prefs.getString("portal", null) == null && !BuildConfig.DEBUG) settings()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("path")?.let { open(it) }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun open(path: String?) {
        val p = path?.takeIf { it.startsWith("/admin/crm") } ?: "/admin/crm"
        web.loadUrl("$portal$p")
    }

    /** The portal's own pages stay in the app (sign-in may pass through the central address); the rest opens in the browser. */
    private fun isPortal(url: Uri?): Boolean {
        if (url == null || url.scheme != "https" && !(BuildConfig.DEBUG && url.scheme == "http")) return false
        val host = url.host ?: return false
        val mine = Uri.parse(portal).host
        return host == mine || host == Uri.parse(BuildConfig.PORTAL).host || host == "investors.lakeba.com"
    }

    private inner class PortalClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (isPortal(url)) {
                if (url.path == "/app-settings") { settings(); return true }
                return false
            }
            // mailto:, tel:, WhatsApp and other sites: their own apps.
            try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: Exception) { }
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        // The microphone (voice notes) and camera (business cards), for the portal's pages only.
        override fun onPermissionRequest(request: PermissionRequest) {
            if (!isPortal(request.origin)) { request.deny(); return }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) request.grant(request.resources)
            else { pendingMic = request; requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2) }
        }

        // File inputs: a photo of a business card (camera or gallery), a document for a deal room.
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try { startActivityForResult(params.createIntent(), 3); true } catch (_: Exception) { fileCallback = null; false }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 3) { fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); fileCallback = null }
    }

    private fun askPermissions() {
        val wanted = mutableListOf(Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= 33) wanted += Manifest.permission.POST_NOTIFICATIONS
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty() || prefs.getBoolean("asked", false)) return
        prefs.edit().putBoolean("asked", true).apply()
        AlertDialog.Builder(this)
            .setTitle("After your calls")
            .setMessage("When a business call ends, the CRM can ask how it went, so you update the deal with a 20-second voice note. It only notices that a call ended: never the number or what was said.")
            .setPositiveButton("Allow") { _, _ -> requestPermissions(missing.toTypedArray(), 1) }
            .setNegativeButton("Not now") { _, _ -> prefs.edit().putBoolean("after_calls", false).apply() }
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == 2) {
            val ok = results.isNotEmpty() && results[0] == PackageManager.PERMISSION_GRANTED
            pendingMic?.let { if (ok) it.grant(it.resources) else it.deny() }
            pendingMic = null
        }
    }

    /** The CRM's address (a venture's own, e.g. https://crm.doxai.com) and the after-call prompt. */
    private fun settings() {
        val address = EditText(this).apply { inputType = InputType.TYPE_TEXT_VARIATION_URI; setText(portal) }
        val calls = CheckBox(this).apply { text = "Ask how a call went when it ends"; isChecked = prefs.getBoolean("after_calls", true) }
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 24, 48, 0); addView(address); addView(calls) }
        AlertDialog.Builder(this)
            .setTitle("Your CRM's address")
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                val v = address.text.toString().trim().let { if (it.startsWith("http")) it else "https://$it" }.trimEnd('/')
                prefs.edit().putString("portal", v).putBoolean("after_calls", calls.isChecked).apply()
                open(null)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
