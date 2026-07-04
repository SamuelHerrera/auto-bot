package com.aomu.printerandroid.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

// ---- DTOs mirroring the KitchenBot API (src/adapters/http/routes/printing.ts) ----

@Serializable
data class QueueItemDto(
    val nameSnapshot: String = "",
    val quantity: Int = 0,
    val unitPriceSnapshot: Double = 0.0
)

@Serializable
data class QueueOrderDto(
    val id: String,
    /** "orderId:revision" — changes whenever the order is edited. */
    val printKey: String,
    val status: String = "",
    val items: List<QueueItemDto> = emptyList()
)

@Serializable
data class PrintQueueResponseDto(
    val ok: Boolean = false,
    val orders: List<QueueOrderDto> = emptyList(),
    val error: String? = null
)

@Serializable
data class AckPrintJobRequestDto(
    val printerIdentifier: String,
    val printKey: String,
    /** PRINTED or FAILED. */
    val printStatus: String,
    val printedAt: String
)

@Serializable
data class AckPrintJobResponseDto(
    val ok: Boolean = false,
    val error: String? = null
)

@Serializable
data class TestPrintResponseDto(
    val ok: Boolean = false,
    val testJobId: String? = null,
    val error: String? = null
)

/**
 * KitchenBot print-queue endpoints. Both are authenticated with the
 * `x-printer-token` header, added by the OkHttp interceptor in [KitchenApiFactory].
 */
interface KitchenApi {

    @GET("kitchens/{kitchenId}/print-queue")
    suspend fun getPrintQueue(
        @Path("kitchenId") kitchenId: String,
        @Query("printerIdentifier") printerIdentifier: String
    ): Response<PrintQueueResponseDto>

    @POST("kitchens/{kitchenId}/print-queue/{orderId}/ack")
    suspend fun ackPrintJob(
        @Path("kitchenId") kitchenId: String,
        @Path("orderId") orderId: String,
        @Body body: AckPrintJobRequestDto
    ): Response<AckPrintJobResponseDto>

    @POST("kitchens/{kitchenId}/printers/{printerIdentifier}/test-print")
    suspend fun createTestPrint(
        @Path("kitchenId") kitchenId: String,
        @Path("printerIdentifier") printerIdentifier: String
    ): Response<TestPrintResponseDto>
}

object KitchenApiFactory {

    private val json = Json { ignoreUnknownKeys = true }

    /** Header name matching the backend's PRINTER_BRIDGE_AUTH_HEADER default. */
    const val PRINTER_TOKEN_HEADER = "x-printer-token"

    fun create(baseUrl: String, printerToken: String): KitchenApi {
        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                chain.proceed(
                    chain.request().newBuilder()
                        .header(PRINTER_TOKEN_HEADER, printerToken)
                        .build()
                )
            }
            .build()

        return Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(KitchenApi::class.java)
    }
}
