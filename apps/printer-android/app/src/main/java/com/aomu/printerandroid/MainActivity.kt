package com.aomu.printerandroid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import com.aomu.printerandroid.ui.PrinterApp

/**
 * Single Activity hosting the Compose navigation graph (MVVM).
 * UI observes PrinterViewModel's StateFlow and never touches Bluetooth directly.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                PrinterApp()
            }
        }
    }
}
