# Local LLM Research: Cocina Economica Customer-Only Extraction

Date: 2026-07-02

## Objective

Evaluate a local model/runtime setup that can extract structured information from WhatsApp-style customer messages for a cocina economica ordering flow.

The extraction target is customer-originated information only. The model should not treat kitchen-provided menu text, prices, totals, confirmations, or calculated delivery information as facts supplied by the customer.

## Recommended Model

Keep using:

```text
gemma-3n-e4b-mx-name
```

Runtime:

```text
LM Studio local server, OpenAI-compatible API on http://localhost:1234/v1
```

Loaded configuration used during testing:

```bash
lms load google/gemma-3n-e4b \
  --identifier gemma-3n-e4b-mx-name \
  --gpu max \
  --context-length 1024 \
  --parallel 50 \
  -y
```

Current useful status command:

```bash
lms ps
```

Expected loaded model row:

```text
IDENTIFIER              MODEL                  CONTEXT    PARALLEL
gemma-3n-e4b-mx-name    google/gemma-3n-e4b    1024       50
```

## Models Tested

| Model identifier | Size | Result |
| --- | ---: | --- |
| `qwen3-0.6b-mx-name` | 351 MB | Very fast, but too many false positives for Mexican Spanish kitchen messages. |
| `gemma-3-1b-it-mx-name` | 772 MB | Faster than E4B, but hallucinated names and no-name cases. Rejected. |
| `qwen3-4b-mx-name` | 2.28 GB | Useful speed fallback. Title-aware extraction scored 18/20 and 50 parallel requests finished in about 10.6s. |
| `qwen3-8b-ab-mx-name` | 4.31 GB | Less accurate than Qwen3 4B for this task. Scored 17/20 and 50 parallel requests finished in about 13.9s. |
| `gemma-3n-e4b-mx-name` | 5.86 GB | Best accuracy. Title-aware name extraction scored 20/20 and 50 parallel requests finished in about 15.5s. |

## Key Test Results

### Name and title extraction

The title-aware schema performed best with `gemma-3n-e4b-mx-name`.

Input examples included Mexican Spanish kitchen phrases such as:

- `a nombre de la señora Carmen`
- `Me dijo Don Pepe`
- `la señora Hernández`
- `El licenciado Ramírez`
- `Didi Food, folio 5512`
- `Mesa 3 pidió otra agua`
- `Comanda 45: torta cubana, sin nombre`

Best schema:

```json
{
  "name": "Pepe",
  "title": "Don",
  "confidence": 0.95
}
```

For no customer:

```json
{
  "name": null,
  "title": null,
  "confidence": 0.1
}
```

Result with `gemma-3n-e4b-mx-name`:

```text
QUALITY name=20/20 title=20/20 both=20/20
PARALLEL_50 total ~= 15.5s
```

### Full conversation extraction

A full cocina economica conversation was tested, including:

- greeting
- kitchen fixed menu
- customer name
- multi-item order
- delivery address
- delivery timing
- total quoted by kitchen
- cash payment
- phone
- per-person notes

The one-shot full JSON extraction took about 42s and extracted many fields, but was not safe enough:

- It got customer identity, phone, address, delivery, payment, and most quantities.
- It got totals wrong.
- It lost some item details and person assignments.
- It sometimes treated kitchen-originated facts as if they were part of the final extracted state.

Conclusion: do not use a single large schema for final order state.

### Targeted extraction passes

Targeted passes were faster and more reliable:

```text
customer/address/payment pass: ~4.4s
items pass: ~4.7s
totals pass: ~3.8s
```

Even with targeted extraction, totals and arithmetic should not be trusted from the model. The model's calculation notes may be right while one numeric subtotal field is wrong. Totals should be calculated deterministically in application code from the fixed menu.

### Customer-only extraction

When the input was restricted to customer messages only, extraction became more aligned with the intended task.

Example customer-only input:

```text
Hola buenos dias, quiero pedir comida para llevar a domicilio.
Si, a nombre de la señora Carmen.
Serian 2 comidas corridas con milanesa de pollo, las dos con sopa de fideo y arroz. Una sin crema por favor.
Si agregame una de pollo en mole pero sin arroz, con frijoles extra. Y 3 aguas, dos de jamaica y una de limon.
Es en calle 59 numero 432 por 48 y 50, colonia Centro, Merida. Es casa amarilla, porton negro. Tocar el timbre de abajo.
Lo antes posible, como en 35 minutos esta bien.
Perfecto, pago en efectivo con uno de 500.
999 123 45 67.
Gracias, por favor que la de mole diga para Luis y la sin crema para Ana.
```

Customer-only extraction with one broad schema took about 7-9s and safely extracted:

- customer name
- phone
- delivery intent
- requested time
- address
- payment method and cash amount
- drinks
- notes such as `mole para Luis` and `sin crema para Ana`

Remaining weak spots:

- title can be missed unless title is the focus of a dedicated pass
- menu item normalization can drift
- guarniciones can be emitted as separate items
- per-person modifiers are better captured as notes first, then resolved in code

## Recommended Architecture

Use multi-pass extraction over customer-originated messages.

1. Split transcript by speaker.
2. Keep only customer messages when extracting customer intent.
3. Run focused extractors on the same customer-only message set.
4. Store raw extracted intent.
5. Resolve menu SKUs, prices, totals, and final kitchen ticket deterministically in application code.

Recommended passes:

| Pass | Purpose |
| --- | --- |
| `customer_identity` | Extract `name`, `title`, and `phone`. |
| `fulfillment` | Extract delivery vs pickup and requested time. |
| `address` | Extract street, number, cross streets, neighborhood, city, and references. |
| `order_intent` | Extract customer-requested items and quantities without pricing. |
| `modifiers_and_notes` | Extract constraints such as `sin crema`, `sin arroz`, `frijoles extra`, `para Luis`, `para Ana`. |
| `payment` | Extract method and cash amount, if customer stated them. |

This can handle either one chat bubble or multiple customer messages:

```text
A nombre de Carmen, calle 59 #432 Centro, quiero 2 milanesas y pago con 500
```

or:

```text
A nombre de Carmen
Mándalo a calle 59 #432 Centro
Quiero 2 milanesas
Pago con 500
```

Both should be normalized into a customer-only message list before extraction:

```json
{
  "messages": [
    "A nombre de Carmen",
    "Mándalo a calle 59 #432 Centro",
    "Quiero 2 milanesas",
    "Pago con 500"
  ]
}
```

## Suggested Schemas

### Customer identity

```json
{
  "name": "Carmen",
  "title": "señora",
  "phone": "999 123 45 67",
  "confidence": 0.95
}
```

### Fulfillment

```json
{
  "type": "delivery",
  "requested_time": "35 minutos",
  "confidence": 0.95
}
```

### Address

```json
{
  "street": "calle 59",
  "exterior_number": "432",
  "cross_streets": "por 48 y 50",
  "neighborhood": "Centro",
  "city": "Merida",
  "references": "casa amarilla, porton negro; tocar el timbre de abajo",
  "confidence": 0.95
}
```

### Order intent

Keep this close to the customer's wording and resolve to fixed menu SKUs later.

```json
{
  "raw_items_requested": [
    {
      "raw_text": "2 comidas corridas con milanesa de pollo, las dos con sopa de fideo y arroz",
      "quantity": 2,
      "candidate_item": "comida corrida con milanesa de pollo",
      "modifiers": [],
      "for_person": null
    },
    {
      "raw_text": "una de pollo en mole pero sin arroz, con frijoles extra",
      "quantity": 1,
      "candidate_item": "comida corrida con pollo en mole",
      "modifiers": ["sin arroz", "frijoles extra"],
      "for_person": "Luis"
    }
  ],
  "confidence": 0.9
}
```

### Payment

```json
{
  "method": "cash",
  "cash_amount": 500,
  "confidence": 0.95
}
```

## Tool Calling

Native tool calling was not reliable in LM Studio with this local Gemma model. When a tool was provided, the model emitted a text block such as:

```json
{
  "name": "store_customer_order_info",
  "arguments": {
    "name": "Carmen",
    "phone": "999 123 45 67"
  }
}
```

but the OpenAI-compatible response did not include native `tool_calls`.

Recommendation:

1. Ask the model for JSON.
2. Validate the JSON with application code.
3. Call storage functions from the app.

Do not let the local model directly perform side effects.

## Operational Guidance

Safe to use the model for:

- extracting customer identity
- extracting address and references
- extracting delivery/pickup intent
- extracting payment method and cash amount
- extracting customer notes and modifiers
- extracting raw requested items

Do not rely on the model for:

- final pricing
- final totals
- delivery fee math
- menu SKU resolution without validation
- direct database writes/tool calls

The fixed menu should be represented in code or data tables. The model should emit raw customer intent, and the application should map intent to menu SKUs and compute the final ticket.

## Local Test Scripts

These scripts were used in the local Codex workspace during research:

```text
work/test_mexican_name_extraction.py
work/test_mx_name_title_extraction.py
work/test_cocina_economica_full_extraction.py
work/test_cocina_economica_targeted_extraction.py
work/test_customer_only_extraction.py
```

They are research artifacts and were not added to the project repo.
