// AI utilities — calls Anthropic Claude API directly from the browser
// using the key stored in business settings (np_settings key='business')

export interface InvoiceExtraction {
  supplier: string
  description: string
  date: string
  receipt_no: string
  cost_ex_gst: number | null
  gst: number | null
  total_inc_gst: number | null
  category: string
  notes: string
}

async function callClaude(
  apiKey: string, messages: any[], system?: string,
  opts?: { model?: string; maxTokens?: number },
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts?.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: opts?.maxTokens ?? 1024,
      system: system ?? 'You are a helpful assistant for a painting business in Australia.',
      messages,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any)?.error?.message ?? `API error ${res.status}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

// Convert a File (image or PDF first-page) to base64 data URL parts
async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const [header, base64] = result.split(',')
      const mediaType = header.replace('data:', '').replace(';base64', '')
      resolve({ base64, mediaType })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Business chat (V16 askInsights) ──────────────────────────
export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export async function askBusiness(apiKey: string, history: ChatTurn[], context: string): Promise<string> {
  const system = `You are an expert business analyst and painting industry consultant for Northern Painters, a painting company based in Byron Bay, NSW, Australia. You have access to all their real business data below.

Answer questions about their jobs, costs, margins, profitability, and business performance. Be specific — use real numbers from the data. Calculate averages, rates per m², best/worst performers, trends. Format answers clearly with numbers highlighted. If you spot anything worth flagging (e.g. low-margin jobs, high material spend) mention it.

When calculating rate per m², note that substrate areas aren't always logged — work with what's available (agreed price ÷ estimated days as a proxy if needed).

${context}`

  return callClaude(apiKey, history, system, { model: 'claude-sonnet-4-6', maxTokens: 1500 })
}

// ── Invoice / receipt OCR ─────────────────────────────────────
export async function extractInvoice(apiKey: string, file: File): Promise<InvoiceExtraction> {
  const { base64, mediaType } = await fileToBase64(file)

  // Claude supports image types; for PDF we'd need to use a JPEG/PNG conversion
  // Accept: image/jpeg, image/png, image/gif, image/webp
  const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const isImage = supportedImageTypes.includes(mediaType)

  let messages: any[]

  if (isImage) {
    messages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: `This is a receipt or invoice from a painting supplies or trade supplier in Australia.
Extract the following fields and return ONLY valid JSON (no markdown, no explanation):
{
  "supplier": "supplier/store name",
  "description": "brief description of what was purchased (e.g. Dulux Weathershield 15L x2, masking tape, rollers)",
  "date": "YYYY-MM-DD or empty string if not found",
  "receipt_no": "invoice or receipt number or empty string",
  "cost_ex_gst": number or null,
  "gst": number or null,
  "total_inc_gst": number or null,
  "category": "one of: Paint, Primer/Undercoat, Filler/Putty, Tape/Masking, Brushes/Rollers, Sandpaper/Prep, Caulk/Sealant, Solvent/Cleaner, Hardware, Other",
  "notes": "any additional useful info"
}
If GST is shown, use it. If only total is shown and no GST line, calculate GST as total/11 and ex-GST as total - GST.
If only ex-GST shown, calculate GST as ex-GST * 0.1 and total as ex-GST * 1.1.`,
        },
      ],
    }]
  } else {
    // PDF or unsupported — try text extraction prompt only
    messages = [{
      role: 'user',
      content: `I have a receipt/invoice file but cannot display it. Please return a default empty extraction as JSON:
{
  "supplier": "",
  "description": "",
  "date": "",
  "receipt_no": "",
  "cost_ex_gst": null,
  "gst": null,
  "total_inc_gst": null,
  "category": "Other",
  "notes": "PDF files need to be converted to image first for AI reading"
}`,
    }]
  }

  const raw = await callClaude(
    apiKey,
    messages,
    'You extract invoice data from images. Return ONLY valid JSON, no markdown fences, no explanation.',
  )

  try {
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      supplier:       String(parsed.supplier ?? ''),
      description:    String(parsed.description ?? ''),
      date:           String(parsed.date ?? ''),
      receipt_no:     String(parsed.receipt_no ?? ''),
      cost_ex_gst:    parsed.cost_ex_gst != null ? Number(parsed.cost_ex_gst) : null,
      gst:            parsed.gst != null ? Number(parsed.gst) : null,
      total_inc_gst:  parsed.total_inc_gst != null ? Number(parsed.total_inc_gst) : null,
      category:       String(parsed.category ?? 'Other'),
      notes:          String(parsed.notes ?? ''),
    }
  } catch {
    throw new Error('AI returned unexpected format. Check your API key and try again.')
  }
}

// ── Quote scope writer ────────────────────────────────────────
export interface QuoteScopeInput {
  client: string
  address: string
  jobType: string
  items: Array<{
    area_name: string
    surface_type: string
    sqm: number
    coats: number
    prep_level: string
    notes: string
  }>
  totalExGST: number
}

export async function generateQuoteScope(apiKey: string, input: QuoteScopeInput): Promise<string> {
  const itemsSummary = input.items.map(it =>
    `- ${it.area_name || it.surface_type}: ${it.surface_type}, ${it.sqm.toFixed(1)} m², ${it.coats} coats, ${it.prep_level} prep${it.notes ? `, ${it.notes}` : ''}`
  ).join('\n')

  const prompt = `You are writing a professional scope of works for a painting quote in Australia.

Client: ${input.client || 'Client'}
Address: ${input.address || 'Site address'}
Job type: ${input.jobType || 'Painting'}
Total quote value: $${input.totalExGST.toFixed(2)} ex GST

Areas to be painted:
${itemsSummary}

Write a clear, professional scope of works for this quote. Use plain language.
Include:
- What surfaces will be prepared and how
- Paint system (coats, finish type where relevant)
- Any important inclusions or exclusions
- A brief professional closing line

Keep it concise — around 100–150 words. No bullet points, use short paragraphs. No pricing in the scope text.`

  const text = await callClaude(apiKey, [{ role: 'user', content: prompt }],
    'You write professional painting quote scope of works text for an Australian painting contractor. Be clear and professional.')

  return text.trim()
}
