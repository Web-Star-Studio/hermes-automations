"""Build the Hermes Automation API guide PDF.

Run from the repo root:
    python3 scripts/build-api-guide-pdf.py
Outputs: docs/api-guide.pdf
"""

from __future__ import annotations

from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPO_ROOT / "docs" / "api-guide.pdf"


# --- Styles ----------------------------------------------------------------

def build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    body_color = colors.HexColor("#111827")
    muted = colors.HexColor("#4b5563")
    accent = colors.HexColor("#1f2937")

    return {
        "title": ParagraphStyle(
            "TitleX",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=26,
            leading=32,
            textColor=accent,
            spaceAfter=8,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=14,
            leading=18,
            textColor=muted,
            spaceAfter=24,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=accent,
            spaceBefore=12,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=accent,
            spaceBefore=12,
            spaceAfter=4,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=accent,
            spaceBefore=8,
            spaceAfter=2,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=body_color,
            spaceAfter=6,
            alignment=TA_LEFT,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=11,
            textColor=muted,
            spaceAfter=4,
        ),
        "code": ParagraphStyle(
            "Code",
            parent=base["Code"],
            fontName="Courier",
            fontSize=8.5,
            leading=11,
            textColor=body_color,
            backColor=colors.HexColor("#f3f4f6"),
            borderPadding=6,
            spaceBefore=4,
            spaceAfter=10,
            leftIndent=0,
        ),
        "endpoint": ParagraphStyle(
            "Endpoint",
            parent=base["Heading3"],
            fontName="Courier-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#1d4ed8"),
            spaceBefore=12,
            spaceAfter=2,
        ),
    }


def hr(width: float = 16 * cm) -> Table:
    line = Table([[""]], colWidths=[width], rowHeights=[1])
    line.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return line


def code_block(text: str, styles: dict[str, ParagraphStyle]) -> Preformatted:
    return Preformatted(text, styles["code"])


def styled_table(data: list[list[str]], col_widths: list[float]) -> Table:
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEADING", (0, 0), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
    ]))
    return t


# --- Endpoint definitions --------------------------------------------------

ENDPOINTS = [
    {
        "method_path": "POST /api/v1/jobs",
        "summary": "Cria um job e enfileira o workflow.",
        "request": (
            "Content-Type: multipart/form-data\n\n"
            "Campos:\n"
            "  file                  arquivo .zip ou .xml (repetir N vezes; 1-50)\n"
            "  flowType              short | complete                  [default: short]\n"
            "  platformId            orizon_fature                     [default: orizon_fature]\n"
            "  platformCredentialId  uuid (opcional). Se enviado, pula validacao humana."
        ),
        "response": (
            "{\n"
            '  "ok": true,\n'
            '  "jobId": "uuid",\n'
            '  "runId": "string",\n'
            '  "fileCount": 2,\n'
            '  "autoApproved": true\n'
            "}"
        ),
        "curl": (
            "curl -X POST http://localhost:3000/api/v1/jobs \\\n"
            '  -H "Authorization: Bearer $KEY" \\\n'
            '  -F "flowType=short" \\\n'
            '  -F "platformCredentialId=<credId>" \\\n'
            '  -F "file=@./lote_1124.zip" \\\n'
            '  -F "file=@./lote_1122.zip"'
        ),
    },
    {
        "method_path": "GET /api/v1/jobs",
        "summary": "Lista os 50 jobs mais recentes do dono da API key.",
        "request": "(sem corpo)",
        "response": (
            "{\n"
            '  "ok": true,\n'
            '  "jobs": [\n'
            '    { "id": "...", "status": "login_succeeded", "fileCount": 3, "tiss": {...}, ... }\n'
            "  ]\n"
            "}"
        ),
        "curl": (
            "curl -H \"Authorization: Bearer $KEY\" \\\n"
            "  http://localhost:3000/api/v1/jobs"
        ),
    },
    {
        "method_path": "GET /api/v1/jobs/{jobId}",
        "summary": "Detalhe completo: status, files[], TISS summary, eventos e estado do workflow.",
        "request": "(sem corpo)",
        "response": (
            "{\n"
            '  "ok": true,\n'
            '  "job":   { ... colunas da tabela jobs ... },\n'
            '  "files": [ { "fileName": "...", "size": "...", "checksum": "..." } ],\n'
            '  "tiss":  { "standardVersion": "4.02.00", "guideCount": "19", ... },\n'
            '  "events": [ { "type": "...", "message": "...", "payload": {...} } ],\n'
            '  "workflow": { "nodes": [...], "edges": [...], "currentNode": "..." }\n'
            "}"
        ),
        "curl": (
            "curl -H \"Authorization: Bearer $KEY\" \\\n"
            "  http://localhost:3000/api/v1/jobs/$JOB_ID"
        ),
    },
    {
        "method_path": "POST /api/v1/jobs/{jobId}/cancel",
        "summary": "Cancela o workflow se o job ainda estiver em execucao. Idempotente.",
        "request": "(sem corpo)",
        "response": (
            "{ \"ok\": true }\n"
            "  ou\n"
            '{ "ok": true, "alreadyTerminal": true, "status": "login_succeeded" }'
        ),
        "curl": (
            "curl -X POST -H \"Authorization: Bearer $KEY\" \\\n"
            "  http://localhost:3000/api/v1/jobs/$JOB_ID/cancel"
        ),
    },
    {
        "method_path": "GET /api/v1/jobs/{jobId}/events",
        "summary": "Stream Server-Sent Events ligado ao workflow run.",
        "request": "Query opcional: startIndex (replay a partir do indice).",
        "response": (
            "Content-Type: text/event-stream\n\n"
            "data: {\"type\":\"agent_tool_completed\",\"message\":\"...\",\"payload\":{...}}\n\n"
            "data: {\"type\":\"submit_tiss_progress\",\"message\":\"...\",\"payload\":{...}}\n\n"
            "...\n\n"
            "Retorna 409 RUN_NOT_READY se o workflow ainda nao iniciou."
        ),
        "curl": (
            "curl -N -H \"Authorization: Bearer $KEY\" \\\n"
            "  http://localhost:3000/api/v1/jobs/$JOB_ID/events"
        ),
    },
    {
        "method_path": "GET /api/v1/platform-credentials",
        "summary": "Lista as credenciais cadastradas pelo dono da API key.",
        "request": "(sem corpo)",
        "response": (
            "{\n"
            '  "ok": true,\n'
            '  "credentials": [\n'
            '    { "id": "...", "platformId": "orizon_fature", "label": "Clinica X",\n'
            '      "usernameMasked": "us***om", "createdAt": "...", "updatedAt": "..." }\n'
            "  ]\n"
            "}"
        ),
        "curl": (
            "curl -H \"Authorization: Bearer $KEY\" \\\n"
            "  http://localhost:3000/api/v1/platform-credentials"
        ),
    },
    {
        "method_path": "POST /api/v1/platform-credentials",
        "summary": "Cria uma credencial. A senha e cifrada com AES-256-GCM no servidor.",
        "request": (
            "Content-Type: application/json\n\n"
            "{\n"
            '  "platformId": "orizon_fature",\n'
            '  "label":      "Clinica X",            (2-80 chars)\n'
            '  "username":   "186870",                 (1-160 chars)\n'
            '  "password":   "SEGREDO"                 (1-512 chars; nunca retornado)\n'
            "}"
        ),
        "response": (
            "{\n"
            '  "ok": true,\n'
            '  "credential": {\n'
            '    "id": "uuid",\n'
            '    "platformId": "orizon_fature",\n'
            '    "label": "Clinica X",\n'
            '    "usernameMasked": "18***70"\n'
            "  }\n"
            "}"
        ),
        "curl": (
            "curl -X POST http://localhost:3000/api/v1/platform-credentials \\\n"
            '  -H "Authorization: Bearer $KEY" \\\n'
            '  -H "Content-Type: application/json" \\\n'
            "  -d '{\"platformId\":\"orizon_fature\",\"label\":\"Clinica X\","
            "\"username\":\"186870\",\"password\":\"SEGREDO\"}'"
        ),
    },
    {
        "method_path": "GET /api/v1/platform-credentials/{id}",
        "summary": "Retorna metadados de uma credencial. Nunca expoe a senha.",
        "request": "(sem corpo)",
        "response": (
            "{\n"
            '  "ok": true,\n'
            '  "credential": { "id": "...", "label": "...", "usernameMasked": "..." }\n'
            "}"
        ),
        "curl": (
            "curl -H \"Authorization: Bearer $KEY\" \\\n"
            "  http://localhost:3000/api/v1/platform-credentials/$CRED_ID"
        ),
    },
    {
        "method_path": "PATCH /api/v1/platform-credentials/{id}",
        "summary": "Atualiza label, username ou password (qualquer subconjunto).",
        "request": (
            "Content-Type: application/json\n\n"
            "{\n"
            '  "label":    "Clinica X (renomeada)",   (opcional)\n'
            '  "username": "186871",                    (opcional)\n'
            '  "password": "NOVO_SEGREDO"               (opcional; re-cifra)\n'
            "}"
        ),
        "response": (
            "{\n"
            '  "ok": true,\n'
            '  "credential": { "id": "...", "label": "...", "usernameMasked": "..." }\n'
            "}"
        ),
        "curl": (
            "curl -X PATCH http://localhost:3000/api/v1/platform-credentials/$CRED_ID \\\n"
            '  -H "Authorization: Bearer $KEY" \\\n'
            '  -H "Content-Type: application/json" \\\n'
            "  -d '{\"password\":\"NOVO_SEGREDO\"}'"
        ),
    },
    {
        "method_path": "DELETE /api/v1/platform-credentials/{id}",
        "summary": "Remove a credencial. Falha com 409 se algum job ainda referencia.",
        "request": "(sem corpo)",
        "response": (
            "{ \"ok\": true }\n"
            "  ou\n"
            '{ "ok": false, "error": { "code": "CREDENTIAL_IN_USE", "message": "..." } }'
        ),
        "curl": (
            "curl -X DELETE -H \"Authorization: Bearer $KEY\" \\\n"
            "  http://localhost:3000/api/v1/platform-credentials/$CRED_ID"
        ),
    },
]


EVENT_TYPES = [
    ("uploaded", "Arquivo TISS recebido pelo storage."),
    ("agent_started", "Workflow durable comecou a rodar o agente."),
    ("agent_tool_called", "Agente invocou uma tool (ingestTiss, fillOrizonCredentials, ...)."),
    ("agent_tool_completed", "Tool terminou (sucesso ou falha capturada na payload)."),
    ("agent_step_started", "Novo step de raciocinio do agente."),
    ("human_validation_requested", "Workflow pausou aguardando aprovacao humana na UI."),
    ("validation_approved", "Validacao aprovada. payload.autoApproved=true se veio via API."),
    ("browser_session_started", "Sessao Browserbase realmente criada (sessionId no payload)."),
    ("browser_action_completed", "Etapa de browser concluiu (login/submit). status=success|failed."),
    ("submit_tiss_progress", "Update intermediario do envio (file_uploaded, batches_selected, ...)."),
    ("submit_tiss_completed", "Lote TISS confirmado pelo portal."),
    ("submit_tiss_failed", "Envio do lote nao confirmou."),
    ("agent_completed", "Workflow encerrou (sucesso ou falha)."),
    ("failed", "Job marcado como falho fora do agente (ex: cancel manual)."),
]


ERROR_CODES = [
    ("UNAUTHORIZED", "401", "Authorization ausente, malformado, revogado ou expirado."),
    ("PENDING_APPROVAL", "403", "Dona(o) da API key nao esta com status approved."),
    ("NOT_FOUND", "404", "Recurso inexistente ou nao pertence ao dono da API key."),
    ("INVALID_BODY", "400", "JSON invalido ou campo obrigatorio faltando."),
    ("FILE_REQUIRED", "400", "POST /jobs sem arquivo no multipart."),
    ("TOO_MANY_FILES", "400", "Mais de 50 arquivos por request."),
    ("CREDENTIAL_NOT_FOUND", "400", "platformCredentialId nao pertence ao dono da API key."),
    ("DUPLICATE_LABEL", "409", "Ja existe credencial com esse label para essa plataforma."),
    ("CREDENTIAL_IN_USE", "409", "Credencial referenciada por job existente; nao pode ser deletada."),
    ("RUN_NOT_READY", "409", "SSE: workflow ainda nao iniciou. Tente novamente em instantes."),
    ("RUN_NOT_FOUND", "404", "SSE: runId desconhecido pelo workflow runtime."),
    ("UPLOAD_FAILED", "400", "Erro generico durante o salvamento de arquivos."),
]


# --- Page header / footer --------------------------------------------------

def on_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    # Footer
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawString(2 * cm, 1.2 * cm, "Hermes Automation — Guia da API REST v1")
    canvas.drawRightString(width - 2 * cm, 1.2 * cm, f"pagina {doc.page}")
    # Header rule
    canvas.setStrokeColor(colors.HexColor("#e5e7eb"))
    canvas.setLineWidth(0.5)
    canvas.line(2 * cm, height - 1.4 * cm, width - 2 * cm, height - 1.4 * cm)
    canvas.restoreState()


# --- Build -----------------------------------------------------------------

def build():
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    styles = build_styles()

    doc = SimpleDocTemplate(
        str(OUTPUT_PATH),
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title="Hermes Automation — Guia da API REST v1",
        author="Webstar",
    )

    story: list = []

    # --- Cover ---
    story.append(Spacer(1, 6 * cm))
    story.append(Paragraph("Hermes Automation", styles["title"]))
    story.append(Paragraph("Guia da API REST v1", styles["title"]))
    story.append(Paragraph("Integração machine-to-machine", styles["subtitle"]))
    story.append(Spacer(1, 8 * cm))
    story.append(Paragraph("30 de abril de 2026", styles["small"]))
    story.append(PageBreak())

    # --- 1. Visão geral ---
    story.append(Paragraph("1. Visão geral", styles["h1"]))
    story.append(Paragraph(
        "A API REST do Hermes expõe o pipeline de automação TISS para sistemas externos. "
        "Um caller pode disparar o fluxo completo (parse do XML, validação, login no portal "
        "Orizon Fature e submissão do lote) sem passar pela UI logada.",
        styles["body"],
    ))
    story.append(Paragraph(
        "Endpoints públicos vivem sob <font face=\"Courier\">/api/v1/*</font>. Toda chamada "
        "exige uma API key Bearer. Recursos (jobs, credenciais, eventos) são estritamente "
        "escopados ao dono da chave — não há tenant compartilhado.",
        styles["body"],
    ))
    story.append(Paragraph(
        "<b>Base URL:</b> <font face=\"Courier\">https://&lt;seu-host&gt;/api/v1/...</font> "
        "(em desenvolvimento, <font face=\"Courier\">http://localhost:3000/api/v1/...</font>).",
        styles["body"],
    ))
    story.append(Paragraph(
        "<b>Audiência:</b> backend developer integrando o Hermes a um ERP, RIS ou outra "
        "ferramenta de gestão clínica que já produz XMLs TISS.",
        styles["body"],
    ))

    # --- 2. Autenticação ---
    story.append(Paragraph("2. Autenticação", styles["h1"]))
    story.append(Paragraph(
        "Toda requisição precisa do header "
        "<font face=\"Courier\">Authorization: Bearer hapi_...</font>. "
        "Sem ele, a API responde <font face=\"Courier\">401 UNAUTHORIZED</font>.",
        styles["body"],
    ))
    story.append(Paragraph("Como criar uma chave", styles["h2"]))
    story.append(Paragraph(
        "1. Faça login na UI com um usuário aprovado.<br/>"
        "2. Vá em <font face=\"Courier\">/app/settings/api-keys</font>.<br/>"
        "3. Clique em <i>Gerar chave</i>, informe um rótulo (ex.: \"Sistema XYZ — produção\") e confirme.<br/>"
        "4. Copie o segredo <b>imediatamente</b>. Ele só aparece uma vez — o servidor armazena apenas "
        "o <font face=\"Courier\">sha256(secret)</font>; a versão em texto puro é descartada.",
        styles["body"],
    ))
    story.append(Paragraph("Formato do segredo", styles["h2"]))
    story.append(Paragraph(
        "<font face=\"Courier\">hapi_</font> + 32 caracteres base32 minúsculos "
        "(ex.: <font face=\"Courier\">hapi_esvxo23eblyqcpgiol6voc7hfpl4ptre</font>). "
        "Os primeiros 13 caracteres formam o <i>prefix</i> exibido na UI para identificar a chave.",
        styles["body"],
    ))
    story.append(Paragraph("Revogação", styles["h2"]))
    story.append(Paragraph(
        "A revogação é imediata e definitiva — basta clicar no ícone de lixeira na linha da chave. "
        "Aplicações que estiverem usando aquela chave receberão <font face=\"Courier\">401</font> "
        "na próxima chamada. Não é possível desfazer.",
        styles["body"],
    ))

    # --- 3. Modelo conceitual ---
    story.append(PageBreak())
    story.append(Paragraph("3. Modelo conceitual", styles["h1"]))

    story.append(Paragraph("3.1 Job lifecycle", styles["h2"]))
    story.append(Paragraph(
        "Um <b>job</b> representa o processamento de 1 ou mais arquivos TISS de um único lote "
        "operacional. O campo <font face=\"Courier\">status</font> evolui assim:",
        styles["body"],
    ))
    lifecycle = [
        ["Status", "Quem seta", "Próximo passo típico"],
        ["uploaded", "POST /jobs (criação)", "Workflow começa o ingestTiss → awaiting_validation"],
        ["awaiting_validation", "tool requestHumanValidation", "Aprovação humana ou auto-aprovação"],
        ["approved", "Resume validation (humano ou auto)", "Login + envio TISS começam → running"],
        ["running", "tool fillOrizonCredentials", "Termina em login_succeeded ou failed"],
        ["login_succeeded", "Login + submit OK", "Terminal (sucesso)"],
        ["failed", "Qualquer erro fatal ou cancel", "Terminal (falha)"],
    ]
    story.append(styled_table(lifecycle, [3.2 * cm, 4.2 * cm, 9 * cm]))

    story.append(Paragraph("3.2 Flow types", styles["h2"]))
    story.append(Paragraph(
        "<b>short</b> (default): faz upload do(s) <font face=\"Courier\">.zip</font> na tela "
        "<i>Enviar XML TISS</i>, marca os lotes válidos e confirma. É o fluxo típico para "
        "produção em massa.<br/><br/>"
        "<b>complete</b>: abre a página <i>Digitar Guia</i> e preenche cada guia campo a campo. "
        "Útil quando o portal recusa o upload em lote ou exige edição manual.",
        styles["body"],
    ))

    story.append(Paragraph("3.3 Platform credentials", styles["h2"]))
    story.append(Paragraph(
        "São as credenciais que o agente usa para logar no portal alvo. A senha é cifrada com "
        "AES-256-GCM (<font face=\"Courier\">CREDENTIAL_ENCRYPTION_KEY</font>) e nunca volta "
        "para o caller — você só vê <font face=\"Courier\">usernameMasked</font>. "
        "Trocar a chave de criptografia invalida todas as senhas armazenadas; quem fizer isso "
        "precisa re-salvar todas as credenciais.",
        styles["body"],
    ))

    story.append(Paragraph("3.4 Auto-approve vs validação humana", styles["h2"]))
    story.append(Paragraph(
        "Se você passa <font face=\"Courier\">platformCredentialId</font> no POST do job, o "
        "workflow detecta isso, pula a tool de aprovação humana e segue direto para o login. "
        "O evento <font face=\"Courier\">validation_approved</font> é emitido com "
        "<font face=\"Courier\">payload.autoApproved=true</font> para deixar isso claro na "
        "auditoria. Se você omite o campo, o workflow pausa e fica aguardando que um humano "
        "aprove pela UI antes de prosseguir — comportamento idêntico ao da UI atual.",
        styles["body"],
    ))

    # --- 4. Endpoints ---
    story.append(PageBreak())
    story.append(Paragraph("4. Endpoints", styles["h1"]))
    for ep in ENDPOINTS:
        story.append(Paragraph(ep["method_path"], styles["endpoint"]))
        story.append(Paragraph(ep["summary"], styles["body"]))
        story.append(Paragraph("Request", styles["h3"]))
        story.append(code_block(ep["request"], styles))
        story.append(Paragraph("Response", styles["h3"]))
        story.append(code_block(ep["response"], styles))
        story.append(Paragraph("Exemplo", styles["h3"]))
        story.append(code_block(ep["curl"], styles))

    # --- 5. Eventos do timeline ---
    story.append(PageBreak())
    story.append(Paragraph("5. Eventos do timeline", styles["h1"]))
    story.append(Paragraph(
        "Toda chamada de tool, transição de status e progresso de browser produz um evento gravado "
        "em <font face=\"Courier\">job_events</font> e replicado no SSE stream. A tabela abaixo "
        "lista os tipos mais comuns; o campo <font face=\"Courier\">payload</font> traz metadados "
        "específicos (status, sessionId, autoApproved, etc.).",
        styles["body"],
    ))
    rows = [["type", "Significado"]] + [list(row) for row in EVENT_TYPES]
    story.append(styled_table(rows, [5.5 * cm, 11 * cm]))

    # --- 6. Erros ---
    story.append(PageBreak())
    story.append(Paragraph("6. Erros", styles["h1"]))
    story.append(Paragraph(
        "Erros sempre vêm no envelope <font face=\"Courier\">{ ok: false, error: { code, message } }</font>. "
        "O <font face=\"Courier\">code</font> é estável e pode ser usado para roteamento programático.",
        styles["body"],
    ))
    rows = [["code", "HTTP", "Significado"]] + [list(row) for row in ERROR_CODES]
    story.append(styled_table(rows, [4.5 * cm, 1.5 * cm, 10.5 * cm]))

    # --- 7. Receita completa ---
    story.append(PageBreak())
    story.append(Paragraph("7. Receita completa", styles["h1"]))
    story.append(Paragraph(
        "Roteiro fim-a-fim para integrar o Hermes em uma rotina noturna de envio de lotes:",
        styles["body"],
    ))
    story.append(Paragraph("Passo 1 — Variáveis", styles["h3"]))
    story.append(code_block(
        "BASE=http://localhost:3000\n"
        "KEY=hapi_xxxxxxxx...    # gerada uma vez na UI",
        styles,
    ))
    story.append(Paragraph("Passo 2 — Cadastrar a credencial Orizon (uma vez)", styles["h3"]))
    story.append(code_block(
        "CRED_ID=$(\n"
        "  curl -s -X POST $BASE/api/v1/platform-credentials \\\n"
        '    -H "Authorization: Bearer $KEY" \\\n'
        '    -H "Content-Type: application/json" \\\n'
        "    -d '{\"platformId\":\"orizon_fature\",\"label\":\"Clinica X\",\n"
        "         \"username\":\"186870\",\"password\":\"SEGREDO\"}' \\\n"
        "  | jq -r '.credential.id'\n"
        ")",
        styles,
    ))
    story.append(Paragraph("Passo 3 — Disparar um job auto-aprovado", styles["h3"]))
    story.append(code_block(
        "JOB=$(\n"
        "  curl -s -X POST $BASE/api/v1/jobs \\\n"
        '    -H "Authorization: Bearer $KEY" \\\n'
        '    -F "flowType=short" \\\n'
        '    -F "platformCredentialId=$CRED_ID" \\\n'
        '    -F "file=@./lote_1124.zip" \\\n'
        '    -F "file=@./lote_1122.zip" \\\n'
        "  | jq -r '.jobId'\n"
        ")\n"
        "echo \"Job criado: $JOB\"",
        styles,
    ))
    story.append(Paragraph("Passo 4 — Polling até o job terminar", styles["h3"]))
    story.append(code_block(
        "while true; do\n"
        "  STATUS=$(\n"
        "    curl -s -H \"Authorization: Bearer $KEY\" \\\n"
        "      $BASE/api/v1/jobs/$JOB | jq -r '.job.status'\n"
        "  )\n"
        "  echo \"$STATUS\"\n"
        "  case \"$STATUS\" in\n"
        "    login_succeeded|failed) break ;;\n"
        "  esac\n"
        "  sleep 5\n"
        "done",
        styles,
    ))
    story.append(Paragraph("Alternativa — SSE em tempo real", styles["h3"]))
    story.append(code_block(
        "curl -N -H \"Authorization: Bearer $KEY\" \\\n"
        "  $BASE/api/v1/jobs/$JOB/events",
        styles,
    ))

    # --- 8. Referência OpenAPI ---
    story.append(PageBreak())
    story.append(Paragraph("8. Referência OpenAPI", styles["h1"]))
    story.append(Paragraph(
        "O contrato formal vive no arquivo <font face=\"Courier\">docs/openapi.yaml</font> "
        "(OpenAPI 3.1) na raiz do repositório. Use-o para:",
        styles["body"],
    ))
    story.append(Paragraph(
        "• gerar SDKs com <font face=\"Courier\">openapi-generator-cli</font>;<br/>"
        "• importar no Postman / Insomnia / Bruno;<br/>"
        "• validar requests/responses em testes contract-first.",
        styles["body"],
    ))
    story.append(Paragraph(
        "O spec define todos os schemas (<font face=\"Courier\">Job</font>, "
        "<font face=\"Courier\">JobEvent</font>, <font face=\"Courier\">TissDocument</font>, "
        "<font face=\"Courier\">PlatformCredential</font>, etc.), os enums "
        "(<font face=\"Courier\">JobStatus</font>, <font face=\"Courier\">JobFlowType</font>, "
        "<font face=\"Courier\">PlatformId</font>) e as respostas de erro padronizadas. "
        "Em caso de divergência entre este guia e o YAML, o YAML é a fonte da verdade.",
        styles["body"],
    ))

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    build()
