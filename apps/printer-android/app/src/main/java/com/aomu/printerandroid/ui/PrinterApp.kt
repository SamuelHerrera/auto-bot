package com.aomu.printerandroid.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.aomu.printerandroid.printer.ConnectionState
import com.aomu.printerandroid.printer.PrinterViewModel

/** Navigation routes. */
private object Routes {
    const val PRINTERS = "printers"
    const val RECEIPT = "receipt"
    const val API_SETTINGS = "api_settings"
}

/**
 * App root: single Activity hosts this NavHost. Navigation is driven by the
 * single ConnectionState — reaching Connected takes us to the receipt screen.
 * The UI observes state and calls the ViewModel; it never touches Bluetooth.
 */
@Composable
fun PrinterApp() {
    val context = LocalContext.current
    val viewModel: PrinterViewModel = viewModel(factory = PrinterViewModel.factory(context))
    val navController = rememberNavController()
    val state by viewModel.state.collectAsState()

    // Advance to the receipt screen the moment we're connected.
    LaunchedEffect(state) {
        if (state is ConnectionState.Connected) {
            navController.navigate(Routes.RECEIPT) { launchSingleTop = true }
        }
    }

    NavHost(navController = navController, startDestination = Routes.PRINTERS) {
        composable(Routes.PRINTERS) {
            PrinterListScreen(
                state = state,
                viewModel = viewModel,
                onOpenApiSettings = { navController.navigate(Routes.API_SETTINGS) }
            )
        }
        composable(Routes.API_SETTINGS) {
            ApiSettingsScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable(Routes.RECEIPT) {
            ReceiptScreen(
                state = state,
                viewModel = viewModel,
                onDisconnect = {
                    viewModel.disconnect()
                    navController.popBackStack(Routes.PRINTERS, inclusive = false)
                }
            )
        }
    }
}
