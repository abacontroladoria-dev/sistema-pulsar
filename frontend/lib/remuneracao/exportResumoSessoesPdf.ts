import { sessoesDoResumo } from "@/lib/remuneracao/demonstrativo"

export function exportResumoSessoesPdf(docInfo: any, sessoesFiltradas: any[]) {
  // Filtro, contagens e agrupamento por dia vivem em demonstrativo.ts — a mesma
  // leitura que a tela Remuneração Individual mostra em "Sessões por dia".
  const { rowsProf, proprias, subs, sessoesPorDia } = sessoesDoResumo(sessoesFiltradas)

  // Generate an HTML string tailored for mobile screen printing
  const printWindow = window.open("", "_blank")
  if (!printWindow) return

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ""
    const parts = dateStr.split("-")
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`
    }
    if (dateStr.includes("/")) {
      const p = dateStr.split("/")
      if (p.length === 3 && p[2].length === 4) {
        return `${p[0]}/${p[1]}/${p[2].slice(2)}`
      }
    }
    return dateStr
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Resumo das Sessões - ${docInfo.principalUpper}</title>
    <style>
      @page {
        size: A4 portrait;
        margin: 15mm;
      }
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: #ffffff;
        color: #1e293b;
        margin: 0;
        font-size: 11px;
      }
      .header {
        background: linear-gradient(135deg, #1e293b 0%, #3b82f6 100%);
        color: white;
        border-radius: 16px;
        padding: 32px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
        box-shadow: 0 10px 25px -5px rgba(59, 130, 246, 0.25);
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 20px;
        text-align: left;
      }
      .header-icon {
        width: 64px;
        height: 64px;
        background: rgba(255, 255, 255, 0.15);
        color: white;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: inset 0 2px 5px rgba(255,255,255,0.1);
      }
      .header-texts h1 {
        font-size: 28px;
        font-weight: 900;
        margin: 0 0 6px 0;
        color: white;
        letter-spacing: -0.02em;
      }
      .header-texts p {
        font-size: 16px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
        margin: 0;
      }
      .header-stats {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 16px 24px;
        border-radius: 12px;
        text-align: right;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .stat-line {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.85);
        font-weight: 600;
      }
      .stat-total {
        font-size: 18px;
        color: white;
        font-weight: 900;
        margin-top: 6px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.25);
      }
      .section-title {
        font-size: 16px;
        font-weight: 800;
        color: #3b82f6;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .grid-cards {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 16px;
        margin-bottom: 35px;
      }
      .card {
        border: 1px solid #e2e8f0;
        background: #fafafa;
        border-radius: 12px;
        padding: 24px;
        page-break-inside: avoid;
      }
      .card-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .day {
        font-size: 14px;
        font-weight: 800;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.02em;
      }
      .date {
        font-size: 13px;
        font-weight: 700;
        background: #e0e7ff;
        color: #4f46e5;
        padding: 6px 14px;
        border-radius: 20px;
      }
      .count-wrap {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .count {
        font-size: 42px;
        font-weight: 900;
        color: #0f172a;
        line-height: 1;
      }
      .trat {
        font-size: 16px;
        font-weight: 600;
        color: #64748b;
      }
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        overflow: hidden;
      }
      th {
        background: #f1f5f9;
        text-align: left;
        padding: 14px 16px;
        font-size: 11px;
        color: #1e293b;
        font-weight: 800;
        border-bottom: 2px solid #cbd5e1;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      td {
        padding: 12px 14px;
        border-bottom: 1px solid #f1f5f9;
        color: #475569;
        font-size: 11px;
        font-weight: 500;
      }
      tr {
        page-break-inside: avoid;
      }
      tr:nth-child(even) td {
        background: #fdfdfd;
      }
      .td-highlight {
        color: #0f172a;
        font-weight: 700;
      }
      .badge-yellow {
        background: #fef08a;
        color: #854d0e;
        padding: 6px 12px;
        border-radius: 20px;
        font-weight: 800;
        font-size: 10px;
        letter-spacing: 0.04em;
        white-space: nowrap;
        display: inline-block;
      }
      .badge-green {
        background: #bbf7d0;
        color: #166534;
        padding: 6px 12px;
        border-radius: 20px;
        font-weight: 800;
        font-size: 10px;
        letter-spacing: 0.04em;
        white-space: nowrap;
        display: inline-block;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="header-left">
        <div class="header-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>
        </div>
        <div class="header-texts">
          <h1>Resumo das Sessões</h1>
          <p>${docInfo.docLabel} ${docInfo.docNumero} &ndash; ${docInfo.principalUpper}</p>
          ${docInfo.tipo === 'pj' ? `<p style="font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.7); margin-top: 4px;">Responsável Legal: ${docInfo.responsavelLegal}</p>` : ''}
        </div>
      </div>
      <div class="header-stats">
        <div class="stat-line">${proprias} evolução(ões) própria(s)</div>
        <div class="stat-line">${subs} substituição(ões)</div>
        <div class="stat-total">${rowsProf.length} sessões no total</div>
      </div>
    </div>

    <div class="section-title">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
      Sessões por dia
    </div>
    
    <div class="grid-cards">
      ${sessoesPorDia.map(group => `
        <div class="card">
          <div class="card-top">
            <span class="day">${group.diaSemana || "Sem dia"}</span>
            <span class="date">${formatDate(group.data)}</span>
          </div>
          <div class="count-wrap">
            <span class="count">${group.rows.length}</span>
            <span class="trat">tratativas</span>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section-title">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
      Detalhamento
    </div>
    
    <table>
      <thead>
        <tr>
          <th><span class="badge-yellow">Agendado Para</span></th>
          <th><span class="badge-green">Tratativa Gerada Por</span></th>
          <th>Dia da Semana</th>
          <th>Data</th>
          <th>Hora</th>
          <th>Cód. Favorecido</th>
          <th>Terapia</th>
        </tr>
      </thead>
      <tbody>
        ${rowsProf.map(row => `
          <tr>
            <td>${row.profAgenda}</td>
            <td>${row.profCsv || row.profAgenda}</td>
            <td>${row.diaSemana}</td>
            <td class="td-highlight">${formatDate(row.data)}</td>
            <td class="td-highlight">${row.hora}</td>
            <td>${row.idFavorecido}</td>
            <td>${row.especialidade}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    <div style="text-align: center; color: #94a3b8; font-size: 10px; margin-top: 30px;">
      Documento gerado em ${new Date().toLocaleDateString("pt-BR")}
    </div>
    
    <script>
      window.onload = () => {
        window.print();
        setTimeout(() => window.close(), 500);
      };
    </script>
  </body>
  </html>
  `

  printWindow.document.open()
  printWindow.document.write(htmlContent)
  printWindow.document.close()
}
