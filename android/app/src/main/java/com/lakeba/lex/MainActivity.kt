package com.lakeba.lex

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Lex on the boardroom tablet: the portal's /tablet page full screen. The tablet shows a six-digit code,
 * the company secretary enters it on the meeting's page, and the meeting's Observer opens here. Nobody
 * signs in on the tablet; the portal decides everything it may reach.
 *
 * What the app adds to a browser: full screen and always awake, the microphone for the portal only,
 * Lex's voice playing without a tap, kiosk mode on a dedicated tablet, and a screen that waits for
 * the network to come back. Five taps in the top-right corner open the settings.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var offline: LinearLayout
    private lateinit var offlineText: TextView
    private val main = Handler(Looper.getMainLooper())
    private var pendingMic: PermissionRequest? = null
    private var cornerTaps = mutableListOf<Long>()
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val prefs by lazy { getSharedPreferences("lex", Context.MODE_PRIVATE) }
    private val portal: String
        get() = (prefs.getString("portal", null) ?: BuildConfig.PORTAL).trimEnd('/')
    private val deviceName: String
        get() = prefs.getString("device_name", null) ?: defaultName()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // The test build can be pointed at another portal when it's started (adb … --es portal http://localhost:4323).
        if (BuildConfig.DEBUG) intent?.getStringExtra("portal")?.let { prefs.edit().putString("portal", it).apply() }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#050B16"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Lex speaks (and its face moves) when an answer arrives, without someone tapping first.
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = "${settings.userAgentString} LexTablet/${BuildConfig.VERSION_NAME}"
            webViewClient = PortalClient()
            webChromeClient = MicClient()
        }
        CookieManager.getInstance().setAcceptCookie(true)

        offlineText = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 22f; gravity = Gravity.CENTER
            text = "Waiting for the network…"
        }
        val retry = Button(this).apply { text = "Try again"; setOnClickListener { load() } }
        offline = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; visibility = View.GONE
            setBackgroundColor(Color.parseColor("#050B16"))
            addView(offlineText); addView(retry, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = 32; gravity = Gravity.CENTER })
        }
        // Five taps in the top-right corner within three seconds open the settings.
        val corner = View(this).apply {
            setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_DOWN) cornerTap(); false }
        }
        val root = FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(offline, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(corner, FrameLayout.LayoutParams(dp(72), dp(72), Gravity.TOP or Gravity.END))
        }
        setContentView(root)

        askForMicrophone()
        watchNetwork()
        if (savedInstanceState == null) load() else web.restoreState(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        fullScreen()
        lockIfOwner()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        networkCallback?.let { (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) }
        web.destroy()
        super.onDestroy()
    }

    // The tablet stays on Lex: Back does nothing (the page has its own buttons).
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() = Unit

    private fun load() {
        offline.visibility = View.GONE
        web.loadUrl("$portal/tablet?device=${Uri.encode(deviceName)}")
    }

    private fun isPortal(url: Uri?) = url != null && Uri.parse(portal).let { it.scheme == url.scheme && it.host == url.host && it.port == url.port }

    private inner class PortalClient : WebViewClient() {
        // Only the portal opens here; anything else (a source link, a document elsewhere) is ignored on the tablet.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = !isPortal(request.url)

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            offlineText.text = "Can't reach the portal (${error.description}).\nTrying again…"
            offline.visibility = View.VISIBLE
            main.postDelayed({ if (offline.visibility == View.VISIBLE) load() }, 5000)
        }
    }

    private inner class MicClient : WebChromeClient() {
        // The microphone goes to the portal's own pages only, and only once Android has allowed it for Lex.
        override fun onPermissionRequest(request: PermissionRequest) {
            val wantsMic = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
            if (!wantsMic || !isPortal(request.origin)) { request.deny(); return }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                pendingMic = request
                requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MIC)
            }
        }
    }

    private fun askForMicrophone() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MIC)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != MIC) return
        val request = pendingMic ?: return
        pendingMic = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request.deny()
    }

    // When the network comes back, the page loads again by itself.
    private fun watchNetwork() {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post { if (offline.visibility == View.VISIBLE) load() }
            }
        }.also { cm.registerDefaultNetworkCallback(it) }
    }

    private fun fullScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }

    // Kiosk mode: when Lex is the tablet's device owner, the tablet is locked to Lex (and the portal's pages).
    private fun lockIfOwner() {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(packageName)) return
        val admin = ComponentName(this, LexDeviceAdmin::class.java)
        dpm.setLockTaskPackages(admin, arrayOf(packageName))
        if (prefs.getBoolean("kiosk", true)) startLockTask()
    }

    private fun cornerTap() {
        val now = System.currentTimeMillis()
        cornerTaps = cornerTaps.filter { now - it < 3000 }.toMutableList().apply { add(now) }
        if (cornerTaps.size >= 5) { cornerTaps.clear(); showSettings() }
    }

    private fun showSettings() {
        val address = EditText(this).apply { setText(portal); inputType = InputType.TYPE_TEXT_VARIATION_URI; hint = "https://investors.lakeba.com" }
        val name = EditText(this).apply { setText(deviceName); hint = "Boardroom tablet" }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(8), dp(24), 0)
            addView(TextView(this@MainActivity).apply { text = "Portal address" }); addView(address)
            addView(TextView(this@MainActivity).apply { text = "This tablet's name (shown on the meeting page)"; setPadding(0, dp(16), 0, 0) }); addView(name)
            addView(TextView(this@MainActivity).apply { text = "Lex ${BuildConfig.VERSION_NAME}"; setPadding(0, dp(16), 0, 0) })
        }
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val owner = dpm.isDeviceOwnerApp(packageName)
        AlertDialog.Builder(this)
            .setTitle("Lex settings")
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                val url = address.text.toString().trim().trimEnd('/')
                if (url.startsWith("https://") || (BuildConfig.DEBUG && url.startsWith("http://localhost"))) prefs.edit().putString("portal", url).apply()
                prefs.edit().putString("device_name", name.text.toString().trim().take(80)).apply()
                load()
            }
            .setNeutralButton(if (owner) (if (prefs.getBoolean("kiosk", true)) "Unlock tablet" else "Lock tablet") else "Android settings") { _, _ ->
                if (owner) {
                    val locked = !prefs.getBoolean("kiosk", true)
                    prefs.edit().putBoolean("kiosk", locked).apply()
                    if (locked) startLockTask() else stopLockTask()
                } else startActivity(android.content.Intent(Settings.ACTION_SETTINGS))
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun defaultName() = "Boardroom tablet (${Build.MODEL})".take(80)
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object { private const val MIC = 1 }
}
