package com.aomu.printerandroid.printer

/**
 * Editable receipt state, held in the ViewModel so it survives rotation,
 * navigation, and mid-print reconnects (the composer used to lose its items
 * when the screen was recomposed). Fields are raw text; parsed on use.
 */
data class ItemDraft(
    val name: String = "",
    val qty: String = "1",
    val price: String = "0.00"
) {
    fun toLineItemOrNull(): LineItem? {
        if (name.isBlank()) return null
        return LineItem(name.trim(), qty.toIntOrNull() ?: 0, price.toDoubleOrNull() ?: 0.0)
    }
}

data class ReceiptDraft(
    val storeName: String = "MY STORE",
    val headerLine1: String = "",
    val headerLine2: String = "",
    val logoPath: String? = null,
    val items: List<ItemDraft> = listOf(
        ItemDraft("Coffee", "1", "3.50"),
        ItemDraft("Bagel", "2", "2.00")
    ),
    val footer: String = "Thank you!"
) {
    val hasPrintableItems: Boolean get() = items.any { it.name.isNotBlank() }

    fun toReceipt(): Receipt =
        Receipt(
            header = storeName,
            items = items.mapNotNull { it.toLineItemOrNull() },
            footer = footer,
            headerLines = listOf(headerLine1, headerLine2).filter { it.isNotBlank() },
            logoPath = logoPath
        )
}
