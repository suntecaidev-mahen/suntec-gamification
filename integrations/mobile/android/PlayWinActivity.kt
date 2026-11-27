// Suntec+ Play & Win — Android (Kotlin + WebView) integration kit.
// Start with: startActivity(Intent(this, PlayWinActivity::class.java).putExtra("url", playWinUrl))
// where playWinUrl comes from YOUR backend (POST /api/v1/integrations/sessions).
package com.suntec.plus.playwin

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class PlayWinActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val startUrl = intent.getStringExtra("url") ?: return finish()
        val playHost = Uri.parse(startUrl).host

        webView = WebView(this)
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.addJavascriptInterface(Bridge(), "SuntecPlayAndroid")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host != playHost) {               // external links → browser
                    startActivity(Intent(Intent.ACTION_VIEW, request.url)); return true
                }
                return false
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            // Camera for in-page QR scanning (also request android.permission.CAMERA at runtime).
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
        }
        webView.loadUrl(startUrl)
    }

    inner class Bridge {
        @JavascriptInterface
        fun postMessage(json: String) {
            val msg = JSONObject(json)
            val data = msg.optJSONObject("data") ?: JSONObject()
            runOnUiThread {
                when (msg.optString("type")) {
                    "close" -> finish()
                    "haptic" -> webView.performHapticFeedback(
                        if (data.optString("kind") == "success") HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.KEYBOARD_TAP)
                    "reward_won", "balance_changed" -> setResult(RESULT_OK)   // refresh points tile on return
                }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
