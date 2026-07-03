'use strict';

var STORAGE_KEY = 'flashcards.pwa.progress.v1';
var MAX_LEVEL = 5;
var MAX_INTERVAL_DAYS = 243;
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
function loadCards() {
  var rawCards = localStorage.getItem(STORAGE_KEY);
  if (!rawCards) return baseCards;
  try {
    var savedCards = JSON.parse(rawCards);
    if (!Array.isArray(savedCards)) return baseCards;
    var savedById = new Map(savedCards.map(function (card) { return [card.id, card]; }));
    return baseCards.map(function (baseCard) {
      var savedCard = savedById.get(baseCard.id);
      if (!savedCard) return baseCard;
      return Object.assign({}, baseCard, {
        level: clampLevel(savedCard.level),
        lastReview: savedCard.lastReview || null,
        nextReview: savedCard.nextReview || baseCard.nextReview,
        successCount: Number.isInteger(savedCard.successCount) ? savedCard.successCount : 0,
        errorCount: Number.isInteger(savedCard.errorCount) ? savedCard.errorCount : 0
      });
    });
  } catch (error) {
    return baseCards;
  }
}
function saveCards() { localStorage.setItem(STORAGE_KEY, JSON.stringify(cards)); }
function isDue(card, referenceDate) { return card.nextReview <= (referenceDate || todayISO()); }
function getDueCards() {
  var referenceDate = todayISO();
  return cards.filter(function (card) { return isDue(card, referenceDate); });
}
function getReviewIntervalDays(level) {
  if (level === 0) return 1;
  return Math.min(Math.pow(3, level), MAX_INTERVAL_DAYS);
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
    (currentCard ? renderCard(currentCard, stats.dueCount) : renderDone()) + renderInstallPanel();
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
      if (action === 'install') promptInstall();
    });
  });
  var cardEl = app.querySelector('.flashcard');
  if (cardEl && currentCard) bindSwipe(cardEl, currentCard.id);
}
function resetProgress() {
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
