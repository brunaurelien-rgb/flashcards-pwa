'use strict';

var STORAGE_KEY = 'flashcards.pwa.progress.v1';
var BACKUP_KEY = STORAGE_KEY + '.backup';
var STORAGE_PREFIX = 'flashcards.pwa.progress';
var REVIEW_INTERVAL_DAYS = [1, 3, 6, 10, 15, 21, 28, 36, 45, 60];
var MAX_LEVEL = REVIEW_INTERVAL_DAYS.length;
var MAX_INTERVAL_DAYS = 60;
var SWIPE_THRESHOLD = 96;
var baseCards = (window.FLASHCARD_ROWS || []).map(createFlashcardFromRow);
var cards = loadCards();
var showShortAnswer = false;
var showDetailedAnswer = false;
var dragState = null;
var deferredInstallPrompt = null;
var app = document.getElementById('app');

window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  deferredInstallPrompt = event;
  render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./service-worker.js').catch(function () {});
  });
}

render();

function padDatePart(value) { return String(value).padStart(2, '0'); }
function toISODate(date) { return date.getFullYear() + '-' + padDatePart(date.getMonth() + 1) + '-' + padDatePart(date.getDate()); }
function todayISO() { return toISODate(new Date()); }
function addDaysToISODate(isoDate, days) {
  var parts = isoDate.split('-').map(Number);
  var date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}
function createFlashcardFromRow(row, index) {
  var reviewDate = todayISO();
  return {
    id: row.id || 'card-' + String(index + 1),
    question: String(row.question || '').trim(),
    answer: String(row.answer || '').trim(),
    detailedAnswer: String(row.detailedAnswer || row.answer || '').trim(),
    level: 0,
    lastReview: null,
    nextReview: reviewDate,
    successCount: 0,
    errorCount: 0
  };
}
function clampLevel(value) {
  var level = Number(value);
  if (!Number.isInteger(level)) return 0;
  return Math.max(0, Math.min(MAX_LEVEL, level));
}
function normalizeCardText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function cardKey(card) {
  return normalizeCardText(card.question) + '|' + normalizeCardText(card.answer);
}
function createUniqueSavedMap(savedCards, getKey) {
  var counts = new Map();
  var map = new Map();
  savedCards.forEach(function (card) {
    var key = getKey(card);
    if (!key || key === '|') return;
    counts.set(key, (counts.get(key) || 0) + 1);
    map.set(key, card);
  });
  Array.from(counts.keys()).forEach(function (key) {
    if (counts.get(key) > 1) map.delete(key);
  });
  return map;
}
function parseSavedCards(rawCards) {
  try {
    var savedCards = JSON.parse(rawCards);
    return Array.isArray(savedCards) ? savedCards : null;
  } catch (error) {
    return null;
  }
}
function reviewTotal(savedCards) {
  return savedCards.reduce(function (total, card) {
    return total + (Number.isInteger(card.successCount) ? card.successCount : 0) + (Number.isInteger(card.errorCount) ? card.errorCount : 0);
  }, 0);
}
function getSavedCardCandidates() {
  var candidates = [];
  for (var index = 0; index < localStorage.length; index += 1) {
    var key = localStorage.key(index);
    if (!key || key.indexOf(STORAGE_PREFIX) !== 0) continue;
    var rawCards = localStorage.getItem(key);
    var savedCards = parseSavedCards(rawCards);
    if (!savedCards) continue;
    candidates.push({ key: key, raw: rawCards, cards: savedCards, reviews: reviewTotal(savedCards) });
  }
  candidates.sort(function (a, b) {
    if (b.reviews !== a.reviews) return b.reviews - a.reviews;
    if (a.key === STORAGE_KEY) return -1;
    if (b.key === STORAGE_KEY) return 1;
    return a.key.localeCompare(b.key);
  });
  return candidates;
}
function mergeSavedProgress(baseCard, savedCard) {
  var savedLevel = clampLevel(savedCard.level);
  return Object.assign({}, baseCard, {
    level: savedLevel,
    lastReview: savedCard.lastReview || null,
    nextReview: getNormalizedNextReview(savedCard, savedLevel, baseCard.nextReview),
    successCount: Number.isInteger(savedCard.successCount) ? savedCard.successCount : 0,
    errorCount: Number.isInteger(savedCard.errorCount) ? savedCard.errorCount : 0
  });
}
function getNormalizedNextReview(savedCard, level, fallbackNextReview) {
  if (!savedCard.nextReview) return fallbackNextReview;
  if (!savedCard.lastReview) return savedCard.nextReview;

  var scheduledNextReview = addDaysToISODate(savedCard.lastReview, getReviewIntervalDays(level));
  return savedCard.nextReview > scheduledNextReview ? scheduledNextReview : savedCard.nextReview;
}
function loadCards() {
  var candidates = getSavedCardCandidates();
  if (!candidates.length) return baseCards;

  var selected = candidates[0];
  var savedCards = selected.cards;
  var savedById = new Map(savedCards.map(function (card) { return [String(card.id), card]; }));
  var savedByCardKey = createUniqueSavedMap(savedCards, cardKey);
  var savedByAnswer = createUniqueSavedMap(savedCards, function (card) { return normalizeCardText(card.answer); });
  var usedSavedCards = new Set();
  var recoveredCount = 0;

  var mergedCards = baseCards.map(function (baseCard) {
    var savedCard = savedById.get(String(baseCard.id));
    if (!savedCard) savedCard = savedByCardKey.get(cardKey(baseCard));
    if (!savedCard) savedCard = savedByAnswer.get(normalizeCardText(baseCard.answer));
    if (!savedCard || usedSavedCards.has(savedCard)) return baseCard;
    usedSavedCards.add(savedCard);
    if (String(savedCard.id) !== String(baseCard.id)) recoveredCount += 1;
    return mergeSavedProgress(baseCard, savedCard);
  });

  if (selected.key !== STORAGE_KEY || recoveredCount > 0) {
    localStorage.setItem(BACKUP_KEY + '.' + Date.now(), selected.raw);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedCards));
  }

  return mergedCards;
}
function saveCards() {
  var currentRaw = localStorage.getItem(STORAGE_KEY);
  if (currentRaw && !localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, currentRaw);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}
function exportProgressBackup() {
  var payload = {
    exportedAt: new Date().toISOString(),
    app: 'flashcards-pwa',
    cards: cards
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'flashcards-progression.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function importProgressBackup(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var payload = JSON.parse(String(reader.result || ''));
      var importedCards = Array.isArray(payload) ? payload : payload.cards;
      if (!Array.isArray(importedCards)) throw new Error('Format invalide');
      localStorage.setItem(BACKUP_KEY + '.beforeImport.' + Date.now(), localStorage.getItem(STORAGE_KEY) || '[]');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(importedCards));
      cards = loadCards();
      render();
    } catch (error) {
      alert('Impossible d importer cette sauvegarde.');
    }
  };
  reader.readAsText(file);
}
function isDue(card, referenceDate) { return card.nextReview <= (referenceDate || todayISO()); }
function getReviewSortDate(card) { return card.lastReview || '0000-00-00'; }
function compareDueCardsByOldestReview(a, b) {
  var reviewDateCompare = getReviewSortDate(a).localeCompare(getReviewSortDate(b));
  if (reviewDateCompare !== 0) return reviewDateCompare;

  var nextReviewCompare = a.nextReview.localeCompare(b.nextReview);
  if (nextReviewCompare !== 0) return nextReviewCompare;

  return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
}
function getDueCards() {
  var referenceDate = todayISO();
  return cards.filter(function (card) { return isDue(card, referenceDate); }).sort(compareDueCardsByOldestReview);
}
function getReviewIntervalDays(level) {
  if (level === 0) return 1;
  return REVIEW_INTERVAL_DAYS[level - 1] || MAX_INTERVAL_DAYS;
}
function applyReviewResult(card, result) {
  var reviewDate = todayISO();
  if (result === 'known') {
    var nextLevel = Math.min(card.level + 1, MAX_LEVEL);
    return Object.assign({}, card, {
      level: nextLevel,
      lastReview: reviewDate,
      nextReview: addDaysToISODate(reviewDate, getReviewIntervalDays(nextLevel)),
      successCount: card.successCount + 1
    });
  }
  return Object.assign({}, card, {
    level: 0,
    lastReview: reviewDate,
    nextReview: addDaysToISODate(reviewDate, 1),
    errorCount: card.errorCount + 1
  });
}
function reviewCard(cardId, result) {
  cards = cards.map(function (card) { return card.id === cardId ? applyReviewResult(card, result) : card; });
  showShortAnswer = false;
  showDetailedAnswer = false;
  saveCards();
  render();
}
function getStats() {
  var knownAnswers = cards.reduce(function (total, card) { return total + card.successCount; }, 0);
  var reviewAnswers = cards.reduce(function (total, card) { return total + card.errorCount; }, 0);
  var answerCount = knownAnswers + reviewAnswers;
  return {
    totalCards: cards.length,
    dueCount: getDueCards().length,
    knownAnswers: knownAnswers,
    reviewAnswers: reviewAnswers,
    successRate: answerCount === 0 ? 0 : Math.round((knownAnswers / answerCount) * 100)
  };
}
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function statBox(value, label) {
  return '<div class="stat-box"><div class="stat-value">' + escapeHtml(value) + '</div><div class="stat-label">' + escapeHtml(label) + '</div></div>';
}
function answerBox(title, text) {
  return '<div class="answer-box"><div class="answer-title">' + escapeHtml(title) + '</div><div class="answer-text">' + escapeHtml(text) + '</div></div>';
}
function renderCard(card, dueCount) {
  var shortClass = showShortAnswer ? 'btn btn-primary' : 'btn btn-secondary';
  var detailedClass = showDetailedAnswer ? 'btn btn-primary' : 'btn btn-secondary';
  return '<section class="review-area">' +
    '<p class="remaining">' + dueCount + ' restantes</p>' +
    '<div class="card-wrap"><article class="flashcard" data-card-id="' + escapeHtml(card.id) + '">' +
    '<div class="swipe-badge swipe-unknown">À revoir</div><div class="swipe-badge swipe-known">Je sais</div>' +
    '<div class="card-meta"><span class="level-pill">Niveau ' + card.level + '</span><span class="next-date">Prochaine: ' + escapeHtml(card.nextReview) + '</span></div>' +
    '<div class="question-block"><p class="question">' + escapeHtml(card.question) + '</p></div>' +
    '<div class="action-stack"><button class="' + shortClass + '" type="button" data-action="toggle-short">Réponse courte</button><button class="' + detailedClass + '" type="button" data-action="toggle-detailed">Réponse détaillée</button></div>' +
    (showShortAnswer ? answerBox('Réponse courte', card.answer) : '') +
    (showDetailedAnswer ? answerBox('Réponse détaillée', card.detailedAnswer) : '') +
    '<div class="review-buttons"><button class="btn btn-danger" type="button" data-action="unknown">Je ne sais pas</button><button class="btn btn-success" type="button" data-action="known">Je sais</button></div>' +
    '</article></div></section>';
}
function renderDone() {
  return '<section class="done-panel"><h2 class="done-title">Révision terminée</h2><p class="done-text">Toutes les cartes prévues pour aujourd\'hui sont faites.</p><button class="btn btn-secondary" type="button" data-action="reset">Réinitialiser la progression</button></section>';
}
function renderBackupPanel() {
  return '<section class="install-panel"><div class="install-title">Sauvegarde</div><p class="install-text">Exporte ta progression avant chaque mise à jour importante.</p><button class="btn btn-secondary" type="button" data-action="export-progress">Exporter la progression</button><button class="btn btn-secondary" type="button" data-action="import-progress">Importer une progression</button><input class="hidden-file-input" type="file" accept="application/json,.json" data-progress-file /></section>';
}
function renderInstallPanel() {
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) return '';
  var installButton = deferredInstallPrompt ? '<button class="btn btn-secondary" type="button" data-action="install">Installer</button>' : '';
  return '<section class="install-panel"><div class="install-title">Installer sur l\'iPhone</div><p class="install-text">Depuis l\'adresse HTTPS, touche Partager, puis “Sur l\'écran d\'accueil”. Ensuite l\'app pourra fonctionner localement sur l\'iPhone.</p>' + installButton + '</section>';
}
function render() {
  var stats = getStats();
  var dueCards = getDueCards();
  var currentCard = dueCards[0];
  app.innerHTML = '<section class="header"><div class="header-title"><h1>Flashcards</h1><p class="subtitle">' + stats.dueCount + ' cartes à réviser aujourd\'hui</p></div><div class="total-pill">' + stats.totalCards + ' cartes</div></section>' +
    '<section class="stats-grid" aria-label="Statistiques">' + statBox(stats.dueCount, 'À revoir') + statBox(stats.knownAnswers, 'Connues') + statBox(stats.successRate + '%', 'Réussite') + '</section>' +
    (currentCard ? renderCard(currentCard, stats.dueCount) : renderDone()) + renderBackupPanel() + renderInstallPanel();
  bindActions(currentCard);
}
function bindActions(currentCard) {
  app.querySelectorAll('[data-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.dataset.action;
      if (action === 'toggle-short') { showShortAnswer = !showShortAnswer; render(); }
      if (action === 'toggle-detailed') { showDetailedAnswer = !showDetailedAnswer; render(); }
      if (currentCard && action === 'known') reviewCard(currentCard.id, 'known');
      if (currentCard && action === 'unknown') reviewCard(currentCard.id, 'unknown');
      if (action === 'reset') resetProgress();
      if (action === 'export-progress') exportProgressBackup();
      if (action === 'import-progress') {
        var input = app.querySelector('[data-progress-file]');
        if (input) input.click();
      }
      if (action === 'install') promptInstall();
    });
  });
  var progressInput = app.querySelector('[data-progress-file]');
  if (progressInput) {
    progressInput.addEventListener('change', function () {
      if (progressInput.files && progressInput.files[0]) importProgressBackup(progressInput.files[0]);
    });
  }
  var cardEl = app.querySelector('.flashcard');
  if (cardEl && currentCard) bindSwipe(cardEl, currentCard.id);
}
function resetProgress() {
  var currentRaw = localStorage.getItem(STORAGE_KEY);
  if (currentRaw) localStorage.setItem(BACKUP_KEY + '.beforeReset.' + Date.now(), currentRaw);
  localStorage.removeItem(STORAGE_KEY);
  cards = baseCards;
  showShortAnswer = false;
  showDetailedAnswer = false;
  render();
}
function promptInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.catch(function () {}).then(function () {
    deferredInstallPrompt = null;
    render();
  });
}
function bindSwipe(cardEl, cardId) {
  cardEl.addEventListener('pointerdown', function (event) {
    if (event.target.closest('button')) return;
    dragState = { startX: event.clientX, currentX: event.clientX, pointerId: event.pointerId };
    cardEl.classList.add('dragging');
    cardEl.setPointerCapture(event.pointerId);
  });
  cardEl.addEventListener('pointermove', function (event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState.currentX = event.clientX;
    var dx = dragState.currentX - dragState.startX;
    updateDragUi(cardEl, dx);
  });
  cardEl.addEventListener('pointerup', function (event) { finishDrag(cardEl, cardId, event.pointerId, false); });
  cardEl.addEventListener('pointercancel', function (event) { finishDrag(cardEl, cardId, event.pointerId, true); });
}
function updateDragUi(cardEl, dx) {
  var rotation = Math.max(-6, Math.min(6, dx / 18));
  cardEl.style.transform = 'translateX(' + dx + 'px) rotate(' + rotation + 'deg)';
  var unknownBadge = cardEl.querySelector('.swipe-unknown');
  var knownBadge = cardEl.querySelector('.swipe-known');
  if (unknownBadge) unknownBadge.style.opacity = String(Math.max(0, Math.min(1, dx / SWIPE_THRESHOLD)));
  if (knownBadge) knownBadge.style.opacity = String(Math.max(0, Math.min(1, -dx / SWIPE_THRESHOLD)));
}
function finishDrag(cardEl, cardId, pointerId, canceled) {
  if (!dragState || dragState.pointerId !== pointerId) return;
  var dx = dragState.currentX - dragState.startX;
  dragState = null;
  cardEl.classList.remove('dragging');
  if (!canceled && dx > SWIPE_THRESHOLD) { animateOut(cardEl, window.innerWidth, function () { reviewCard(cardId, 'unknown'); }); return; }
  if (!canceled && dx < -SWIPE_THRESHOLD) { animateOut(cardEl, -window.innerWidth, function () { reviewCard(cardId, 'known'); }); return; }
  cardEl.style.transform = '';
  cardEl.querySelectorAll('.swipe-badge').forEach(function (badge) { badge.style.opacity = '0'; });
}
function animateOut(cardEl, targetX, done) {
  var rotation = targetX > 0 ? 6 : -6;
  cardEl.style.transform = 'translateX(' + targetX + 'px) rotate(' + rotation + 'deg)';
  cardEl.style.opacity = '0.4';
  window.setTimeout(done, 170);
}
