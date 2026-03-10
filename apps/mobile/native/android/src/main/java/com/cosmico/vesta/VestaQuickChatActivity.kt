package com.cosmico.vesta

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * A floating search-bar-style activity that appears centered on screen
 * when the user taps the widget. Feels like the widget itself expanded
 * into an editable input field.
 */
class VestaQuickChatActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setDimAmount(0.35f)
            attributes = attributes.apply {
                gravity = Gravity.CENTER
                width = WindowManager.LayoutParams.MATCH_PARENT
                height = WindowManager.LayoutParams.WRAP_CONTENT
            }
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or
                    WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN)
        }

        // Vesta pastel colors
        val surfaceColor = Color.parseColor("#FFFFFF")
        val bgColor = Color.parseColor("#F8F5F1")
        val accentColor = Color.parseColor("#C07A56")
        val borderColor = Color.parseColor("#E5DED5")
        val textColor = Color.parseColor("#2C2620")
        val placeholderColor = Color.parseColor("#C4BAB0")
        val mutedText = Color.parseColor("#A89E94")

        val dp = { value: Float ->
            TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics).toInt()
        }

        // Full-screen tap-to-dismiss wrapper
        val wrapper = FrameLayout(this).apply {
            setOnClickListener { finish() }
        }

        // Card container — looks like an expanded widget bar
        val cardBg = GradientDrawable().apply {
            setColor(surfaceColor)
            cornerRadius = dp(24f).toFloat()
            setStroke(dp(1f), borderColor)
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBg
            setPadding(dp(6f), dp(6f), dp(6f), dp(6f))
            elevation = dp(8f).toFloat()
            // Prevent card click from dismissing
            setOnClickListener { }
        }

        // Input row: flame icon + EditText + send button
        val inputRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10f), dp(4f), dp(4f), dp(4f))
        }

        // Flame icon
        val flameIcon = ImageView(this).apply {
            setImageResource(R.drawable.ic_vesta_flame)
        }
        val flameParams = LinearLayout.LayoutParams(dp(26f), dp(26f)).apply {
            marginEnd = dp(10f)
        }
        inputRow.addView(flameIcon, flameParams)

        // EditText — main input
        val inputBg = GradientDrawable().apply {
            setColor(Color.TRANSPARENT)
        }

        val editText = EditText(this).apply {
            hint = "Message Vesta\u2026"
            setHintTextColor(placeholderColor)
            setTextColor(textColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = inputBg
            setPadding(dp(4f), dp(10f), dp(4f), dp(10f))
            maxLines = 4
            isSingleLine = false
            imeOptions = EditorInfo.IME_ACTION_SEND
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                    android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
                    android.text.InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
        }
        val editParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        inputRow.addView(editText, editParams)

        // Send button
        val sendBtnBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(accentColor)
        }
        val sendBtn = TextView(this).apply {
            text = "\u2191"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            gravity = Gravity.CENTER
            background = sendBtnBg
        }
        val sendParams = LinearLayout.LayoutParams(dp(38f), dp(38f)).apply {
            marginStart = dp(6f)
        }
        inputRow.addView(sendBtn, sendParams)

        card.addView(inputRow)

        // Position card with horizontal margin
        val cardParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        ).apply {
            marginStart = dp(16f)
            marginEnd = dp(16f)
        }
        wrapper.addView(card, cardParams)

        setContentView(wrapper)

        // Send action
        val doSend = {
            val text = editText.text.toString().trim()
            if (text.isNotEmpty()) {
                val intent = Intent(this, MainActivity::class.java).apply {
                    action = Intent.ACTION_VIEW
                    data = Uri.parse("vesta://chat?voice_text=${Uri.encode(text)}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
                startActivity(intent)
                overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
                finish()
            }
        }

        sendBtn.setOnClickListener { doSend() }

        editText.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_SEND ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            ) {
                doSend()
                true
            } else {
                false
            }
        }

        // Auto-focus and show keyboard
        editText.requestFocus()
    }

    override fun onBackPressed() {
        super.onBackPressed()
        overridePendingTransition(0, android.R.anim.fade_out)
    }
}
