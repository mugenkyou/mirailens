document.addEventListener('DOMContentLoaded', () => {
  let ledger = [];
  let filteredLedger = [];
  let currentPage = 1;
  const pageSize = 20;
  let activeEntry = null;

  // DOM Elements
  const summaryAiActions = document.getElementById('summary-ai-actions');
  const summaryHumanActions = document.getElementById('summary-human-actions');
  const summaryBlockedActions = document.getElementById('summary-blocked-actions');
  const summaryVerifiedActions = document.getElementById('summary-verified-actions');

  const filterSession = document.getElementById('filter-session');
  const filterActor = document.getElementById('filter-actor');
  const filterOutcome = document.getElementById('filter-outcome');
  const filterDomain = document.getElementById('filter-domain');

  const btnExport = document.getElementById('btn-export');
  const btnClear = document.getElementById('btn-clear');

  const historyTbody = document.getElementById('history-tbody');
  const emptyState = document.getElementById('empty-state');
  const paginationInfo = document.getElementById('pagination-info');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');

  // Modal elements
  const detailsModal = document.getElementById('details-modal');
  const modalClose = document.getElementById('modal-close');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnUndo = document.getElementById('btn-undo');

  const detailId = document.getElementById('detail-id');
  const detailSession = document.getElementById('detail-session');
  const detailTime = document.getElementById('detail-time');
  const detailActor = document.getElementById('detail-actor');
  const detailType = document.getElementById('detail-type');
  const detailDomain = document.getElementById('detail-domain');
  const detailTarget = document.getElementById('detail-target');
  const detailDecision = document.getElementById('detail-decision');
  const detailOutcome = document.getElementById('detail-outcome');
  const detailVerification = document.getElementById('detail-verification');
  const detailUndoStatus = document.getElementById('detail-undo-status');

  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');

  // Load ledger data
  function loadLedger() {
    chrome.runtime.sendMessage({ cmd: 'getLedger' }, (response) => {
      ledger = response?.ledger || [];
      populateSessions();
      updateSummaries();
      applyFiltersAndRender();
    });
  }

  // Populate unique Session IDs in filter dropdown
  function populateSessions() {
    const prevSelected = filterSession.value;
    filterSession.innerHTML = '<option value="ALL">All Sessions</option>';
    const sessions = [...new Set(ledger.map(e => e.sessionId).filter(Boolean))];
    sessions.forEach(sid => {
      const opt = document.createElement('option');
      opt.value = sid;
      opt.textContent = sid.substring(0, 16) + '...';
      filterSession.appendChild(opt);
    });
    if (sessions.includes(prevSelected)) {
      filterSession.value = prevSelected;
    }
  }

  // Calculate high-level summary cards from ledger data
  function updateSummaries() {
    const aiCount = ledger.filter(e => e.actor === 'AI').length;
    const humanCount = ledger.filter(e => e.actor === 'HUMAN').length;
    const blockedCount = ledger.filter(e => e.outcome === 'BLOCKED' || e.decision === 'DENIED').length;
    const verifiedCount = ledger.filter(e => e.outcome === 'VERIFIED').length;

    summaryAiActions.textContent = aiCount;
    summaryHumanActions.textContent = humanCount;
    summaryBlockedActions.textContent = blockedCount;
    summaryVerifiedActions.textContent = verifiedCount;
  }

  // Filter and display matching rows with pagination
  function applyFiltersAndRender() {
    const sessionVal = filterSession.value;
    const actorVal = filterActor.value;
    const outcomeVal = filterOutcome.value;
    const domainVal = filterDomain.value.toLowerCase().trim();

    filteredLedger = [...ledger];

    if (sessionVal !== 'ALL') {
      filteredLedger = filteredLedger.filter(e => e.sessionId === sessionVal);
    }
    if (actorVal !== 'ALL') {
      filteredLedger = filteredLedger.filter(e => e.actor === actorVal);
    }
    if (outcomeVal !== 'ALL') {
      filteredLedger = filteredLedger.filter(e => e.outcome === outcomeVal);
    }
    if (domainVal) {
      filteredLedger = filteredLedger.filter(e => e.domain && e.domain.toLowerCase().includes(domainVal));
    }

    // Sort descending chronologically
    filteredLedger.sort((a, b) => b.timestamp - a.timestamp);

    const total = filteredLedger.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, total);

    historyTbody.innerHTML = '';
    if (total === 0) {
      emptyState.classList.remove('hidden');
      paginationInfo.textContent = 'Showing 0-0 of 0';
    } else {
      emptyState.classList.add('hidden');
      paginationInfo.textContent = `Showing ${startIdx + 1}-${endIdx} of ${total}`;

      const pageSlice = filteredLedger.slice(startIdx, endIdx);
      pageSlice.forEach(entry => {
        const tr = document.createElement('tr');
        tr.className = 'row-clickable';
        tr.dataset.id = entry.id;

        const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const actorClass = entry.actor === 'AI' ? 'badge-ai' : 'badge-human';
        const outcomeClass = getOutcomeClass(entry.outcome);

        tr.innerHTML = `
          <td class="time-col">${timeStr}</td>
          <td><span class="badge ${actorClass}">${entry.actor}</span></td>
          <td class="action-col">${entry.actionType.replace('browser_', '')}</td>
          <td class="target-col" title="${entry.target || ''}">${entry.target || '-'}</td>
          <td><span class="badge ${outcomeClass}">${entry.outcome.replace('_', ' ')}</span></td>
        `;

        tr.addEventListener('click', () => openModal(entry.id));
        historyTbody.appendChild(tr);
      });
    }

    btnPrev.disabled = (currentPage === 1);
    btnNext.disabled = (currentPage === totalPages);
  }

  function getOutcomeClass(outcome) {
    switch (outcome) {
      case 'VERIFIED': return 'badge-verified';
      case 'UNVERIFIED_COMPLETE': return 'badge-unverified';
      case 'FAILED': return 'badge-failed';
      case 'BLOCKED': return 'badge-blocked';
      case 'CANCELLED': return 'badge-cancelled';
      default: return 'badge-cancelled';
    }
  }

  // Open detail dialog
  function openModal(id) {
    activeEntry = ledger.find(e => e.id === id);
    if (!activeEntry) return;

    detailId.textContent = activeEntry.id;
    detailSession.textContent = activeEntry.sessionId;
    detailTime.textContent = new Date(activeEntry.timestamp).toLocaleString();
    detailActor.textContent = activeEntry.actor;
    detailType.textContent = activeEntry.actionType;
    detailDomain.textContent = activeEntry.domain || '-';
    detailTarget.textContent = activeEntry.target || '-';
    detailDecision.textContent = activeEntry.decision;
    detailOutcome.textContent = activeEntry.outcome;

    if (activeEntry.verification) {
      detailVerification.textContent = `${activeEntry.verification.outcome} (${activeEntry.verification.reasons?.join(', ') || 'No reasons specified'})`;
    } else if (activeEntry.reason) {
      detailVerification.textContent = `FAILED: ${activeEntry.reason}`;
    } else {
      detailVerification.textContent = '-';
    }

    const isReversible = activeEntry.reversible && activeEntry.snapshotId;
    if (isReversible) {
      detailUndoStatus.textContent = 'Undo available';
      btnUndo.classList.remove('hidden');
    } else {
      detailUndoStatus.textContent = activeEntry.actionType === 'undo_last' ? 'Already an Undo' : 'Not reversible';
      btnUndo.classList.add('hidden');
    }

    detailsModal.classList.add('show');
  }

  function closeModal() {
    detailsModal.classList.remove('show');
    activeEntry = null;
  }

  // Toast Notification System
  function showToast(text) {
    toastText.textContent = text;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // Event Listeners
  filterSession.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
  filterActor.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
  filterOutcome.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
  filterDomain.addEventListener('input', () => { currentPage = 1; applyFiltersAndRender(); });

  btnPrev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; applyFiltersAndRender(); } });
  btnNext.addEventListener('click', () => { currentPage++; applyFiltersAndRender(); });

  modalClose.addEventListener('click', closeModal);
  btnCloseModal.addEventListener('click', closeModal);

  // Undo Action Trigger
  btnUndo.addEventListener('click', () => {
    if (!activeEntry) return;
    const targetId = activeEntry.id;
    btnUndo.disabled = true;
    showToast('Executing undo restoration...');

    chrome.runtime.sendMessage({ cmd: 'undoAction', id: targetId }, (response) => {
      btnUndo.disabled = false;
      closeModal();
      if (response && response.success) {
        showToast('Restoration completed and verified successfully.');
      } else {
        showToast('Restoration failed: ' + (response?.reason || 'Unknown error'));
      }
      loadLedger();
    });
  });

  // Local JSON Export (Performing zero network actions)
  btnExport.addEventListener('click', () => {
    if (filteredLedger.length === 0) {
      showToast('No entries to export.');
      return;
    }
    const cleanExport = filteredLedger.map(e => ({
      id: e.id,
      sessionId: e.sessionId,
      timestamp: e.timestamp,
      actor: e.actor,
      actionType: e.actionType,
      target: e.target,
      domain: e.domain,
      decision: e.decision,
      state: e.state,
      outcome: e.outcome,
      reversible: e.reversible,
      verification: e.verification,
      reason: e.reason
    }));

    const blob = new Blob([JSON.stringify(cleanExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mirailens_ledger_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${cleanExport.length} entries successfully.`);
  });

  // Clear local logs database
  btnClear.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the entire action log database? This cannot be undone.')) {
      chrome.runtime.sendMessage({ cmd: 'clearLedger' }, (response) => {
        if (response && response.success) {
          showToast('Ledger cleared successfully.');
          loadLedger();
        }
      });
    }
  });

  // Listen for dynamic updates broadcasted by background.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.cmd === 'ledgerUpdated') {
      loadLedger();
    }
  });

  // Initialize page
  loadLedger();
});
