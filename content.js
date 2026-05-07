// content.js
// ========== ХРАНИЛИЩЕ ФАКТОВ И ХЕШЕЙ ==========
let facts = {};
let processedHashes = new Set();
let commandsEnabled = true;
let cachedPrompt = null; // ← исправлено (была утеряна)

function loadData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['deepseek_facts', 'processed_hashes', 'commandsEnabled'], (result) => {
      if (result.deepseek_facts) {
        const raw = JSON.parse(result.deepseek_facts);
        if (Array.isArray(raw)) {
          facts = {};
          raw.forEach((item, index) => {
            const id = `legacy_${index + 1}`;
            facts[id] = { timestamp: item.timestamp, text: item.text };
          });
        } else {
          facts = raw;
        }
      } else {
        facts = {};
      }

      processedHashes = result.processed_hashes ? new Set(JSON.parse(result.processed_hashes)) : new Set();
      
      if (result.commandsEnabled !== undefined) {
        commandsEnabled = result.commandsEnabled;
      }
      
      resolve();
    });
  });
}

function saveFacts() {
  chrome.storage.local.set({ deepseek_facts: JSON.stringify(facts) });
}

function saveProcessedHashes() {
  const arr = [...processedHashes].slice(-500);
  chrome.storage.local.set({ processed_hashes: JSON.stringify(arr) });
}

function saveCommandsEnabled() {
  chrome.storage.local.set({ commandsEnabled });
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
}

// ========== ФАКТЫ ==========
function generateFactId() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
}

function addFact(text) {
  const id = generateFactId();
  facts[id] = { timestamp: new Date().toISOString(), text };
  saveFacts();
  return `✅ Факт сохранён (ID: ${id}): "${text}" (всего ${Object.keys(facts).length})`;
}

function deleteFact(id) {
  if (facts.hasOwnProperty(id)) {
    const text = facts[id].text;
    delete facts[id];
    saveFacts();
    return `🗑 Факт ${id} удалён: "${text}" (осталось ${Object.keys(facts).length})`;
  }
  return `❌ Факт с ID "${id}" не найден.`;
}

function clearFacts() {
  facts = {};
  saveFacts();
  return '🧹 Все факты удалены';
}

function getFactsList() {
  const ids = Object.keys(facts);
  if (!ids.length) return 'нет сохранённых фактов.';
  return ids.map(id => `[${id}] ${facts[id].timestamp}: ${facts[id].text}`).join('\n');
}

// ========== УВЕДОМЛЕНИЯ ==========
function showNotification(msg, isError = false) {
  const div = document.createElement('div');
  div.textContent = msg;
  Object.assign(div.style, {
    position: 'fixed', bottom: '20px', right: '20px',
    backgroundColor: isError ? '#c0392b' : '#2c3e50',
    color: '#fff', padding: '8px 16px', borderRadius: '8px',
    zIndex: '9999', fontSize: '14px', fontFamily: 'sans-serif',
    maxWidth: '350px', wordBreak: 'break-word',
  });
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// ========== ВСПЛЫВАЮЩЕЕ ОКНО ДЛЯ SHOW ==========
function showPopup(htmlContent) {
  const existing = document.getElementById('deepseek-popup-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'deepseek-popup-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.5); z-index: 100000; display: flex;
    align-items: center; justify-content: center;
  `;

  const container = document.createElement('div');
  container.style.cssText = `
    background: white; border-radius: 12px; padding: 20px;
    max-width: 90vw; max-height: 90vh; overflow: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    position: relative; font-family: sans-serif;
  `;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✖';
  closeBtn.style.cssText = `
    position: absolute; top: 8px; right: 12px;
    background: transparent; border: none; font-size: 20px;
    cursor: pointer; color: #555;
  `;
  closeBtn.onclick = () => overlay.remove();

  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = htmlContent;

  container.appendChild(closeBtn);
  container.appendChild(contentDiv);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ========== ПОЛЕ ВВОДА (универсальное) ==========
function findChatInput() {
  // 1. Обычный режим: div[contenteditable]
  const editable = document.querySelector('div[contenteditable="true"][role="textbox"]');
  if (editable) return editable;

  // 2. Режим редактирования: textarea внутри .ds-textarea
  const editTextarea = document.querySelector('.ds-textarea textarea');
  if (editTextarea) return editTextarea;

  // 3. Запасные варианты
  const selectors = [
    'textarea[placeholder*="DeepSeek"]',
    'textarea[placeholder*="Сообщение"]',
    'textarea[placeholder*="Message"]',
    '#chat-input textarea',
    '#chat-textarea',
    'textarea[data-id="root"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  const textareas = document.querySelectorAll('textarea');
  return textareas[textareas.length - 1] || null;
}

// ========== ОТПРАВКА СООБЩЕНИЯ ==========
function sendAsUser(text) {
  const PREFIX = '[СИСТЕМНОЕ СООБЩЕНИЕ] ';
  const fullText = PREFIX + text;
  const input = findChatInput();
  if (!input) {
    showNotification('❌ Поле ввода не найдено', true);
    return;
  }

  input.focus();

  if (input.isContentEditable) {
    input.textContent = '';
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, fullText);

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    input.value = fullText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  waitForSendButtonAndClick(input);
}

// ========== ПОИСК КНОПКИ ОТПРАВКИ РЯДОМ С ПОЛЕМ ==========
function findSendButton(input) {
  if (input.closest) {
    // 1. Режим редактирования
    const editContainer = input.closest('.ds-textarea');
    if (editContainer) {
      const btn = editContainer.querySelector('div[role="button"].ds-basic-button--primary');
      if (btn && btn.offsetParent !== null) return btn;
    }

    // 2. Обычный режим: ищем кнопку отправки (стрелка) с классом _52c986b в том же контейнере
    const form = input.closest('form') || input.closest('[class*="chat"]') || document.body;
    const sendBtn = form.querySelector('div[role="button"]._52c986b');
    if (sendBtn && sendBtn.offsetParent !== null && !sendBtn.disabled) return sendBtn;

    // Запасной: кнопка Send в режиме редактирования (если вдруг другой селектор)
    const altSend = form.querySelector('div[role="button"].ds-basic-button--primary');
    if (altSend && altSend.offsetParent !== null && !altSend.disabled) return altSend;
  }

  // Глобальный поиск (исключая наши кнопки)
  const allBtns = document.querySelectorAll(
    'button[aria-label="Send"], button[aria-label="Отправить"], button[title="Отправить"], ' +
    'div[role="button"]._52c986b, div[role="button"].ds-basic-button--primary'
  );
  for (const btn of allBtns) {
    if (btn.id === 'ext-insert-prompt' || btn.id === 'ext-commands-toggle') continue;
    if (btn.closest('#ext-commands-toggle')) continue;
    if (btn.offsetParent !== null && !btn.disabled) return btn;
  }
  return null;
}

// ========== ОТПРАВКА СООБЩЕНИЯ ==========
function waitForSendButtonAndClick(input) {
  const maxAttempts = 20; // чуть больше попыток
  let attempts = 0;

  const tryToSend = () => {
    const sendBtn = findSendButton(input);
    if (sendBtn && !sendBtn.disabled && sendBtn.offsetParent !== null) {
      sendBtn.click();
      return;
    }

    if (attempts++ < maxAttempts) {
      setTimeout(tryToSend, 150); // чуть дольше интервал
    } else {
      // Если не удалось, пробуем Enter на поле ввода
      const eventOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
      input.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
      input.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
      input.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
    }
  };

  tryToSend();
}

// ========== ВЫПОЛНЕНИЕ JS ==========
function executeJS(code) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = chrome.runtime.getURL('sandbox.html');
    document.body.appendChild(iframe);

    const id = Date.now() + Math.random();
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      document.body.removeChild(iframe);
      resolve({ success: false, error: 'Таймаут выполнения JS (10 сек)' });
    }, 10000);

    const handler = (event) => {
      if (event.data.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      document.body.removeChild(iframe);
      resolve(event.data);
    };
    window.addEventListener('message', handler);

    iframe.onload = () => {
      iframe.contentWindow.postMessage({ id, code }, '*');
    };
  });
}

// ========== ПРОМПТ ==========
const PROMPT_URL = chrome.runtime.getURL('prompt.txt');

async function getPromptText() {
  try {
    const response = await fetch(PROMPT_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cachedPrompt = await response.text();
    return cachedPrompt;
  } catch (e) {
    console.error('Ошибка загрузки prompt.txt:', e);
    return '[СИСТЕМНОЕ СООБЩЕНИЕ] Ошибка загрузки системного промпта. Пожалуйста, выполните facts вручную.';
  }
}

// ========== НОВЫЕ КНОПКИ ==========
function createCommandsToggle() {
  const btn = document.createElement('div');
  btn.id = 'ext-commands-toggle';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.className = 'ds-atom-button f79352dc ds-toggle-button ds-toggle-button--md';
  btn.innerHTML = `<span class="_6dbc175">Команды расширения</span><div class="ds-focus-ring"></div>`;
  
  updateCommandsToggle(btn);
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    commandsEnabled = !commandsEnabled;
    saveCommandsEnabled();
    updateCommandsToggle(btn);
  });
  
  return btn;
}

function updateCommandsToggle(btn) {
  if (commandsEnabled) {
    btn.classList.add('ds-toggle-button--selected');
  } else {
    btn.classList.remove('ds-toggle-button--selected');
  }
}

function createInsertPromptButton() {
  const btn = document.createElement('div');
  btn.id = 'ext-insert-prompt';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.className = 'ds-icon-button ds-icon-button--l ds-icon-button--sizing-container';
  btn.innerHTML = `
    <div class="ds-icon-button__hover-bg"></div>
    <div class="ds-icon" style="font-size:14px; width:16px; height:16px; display:flex; align-items:center; justify-content:center;">P</div>
    <div class="ds-focus-ring"></div>
  `;
  btn.title = 'Вставить начальный промпт';
  
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const input = findChatInput();
    if (!input) return;
    const promptText = await getPromptText();
    input.focus();
    if (input.isContentEditable) {
      document.execCommand('insertText', false, promptText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value += promptText;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  
  return btn;
}

function injectButtons() {
  const panel = document.querySelector('.ec4f5d61');
  if (!panel) return;

  if (document.getElementById('ext-commands-toggle') || document.getElementById('ext-insert-prompt')) return;

  const toggles = panel.querySelectorAll(':scope > .ds-toggle-button');
  const searchBtn = toggles.length >= 2 ? toggles[1] : null;
  
  if (searchBtn) {
    const commandsToggle = createCommandsToggle();
    searchBtn.after(commandsToggle);
  }

  const attachContainer = panel.querySelector('.bf38813a');
  if (attachContainer) {
    const insertBtn = createInsertPromptButton();
    const firstChild = attachContainer.firstElementChild;
    if (firstChild) {
      attachContainer.insertBefore(insertBtn, firstChild);
    } else {
      attachContainer.appendChild(insertBtn);
    }
  }
}

function startInjectObserver() {
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('.ec4f5d61') || node.querySelector && node.querySelector('.ec4f5d61')) {
          injectButtons();
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// ========== ПЕРЕХВАТ ОТПРАВКИ (универсальный) ==========
function isSystemMessage(text) {
  return text.startsWith('[СИСТЕМНОЕ СООБЩЕНИЕ]') || text.includes('[СИСТЕМНАЯ ИНФОРМАЦИЯ]');
}

function getSystemInfoSuffix() {
  const time = new Date().toLocaleString();
  const status = commandsEnabled ? 'команды доступны' : 'команды отключены';
  return `\n\n[СИСТЕМНАЯ ИНФОРМАЦИЯ] ${time}, ${status}`;
}

function addSystemInfoToInput(input) {
  if (!input || input.dataset.systemInfoAdded === 'true') return;
  
  let text = '';
  if (input.isContentEditable) {
    text = input.textContent || '';
  } else if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    text = input.value || '';
  }
  
  if (!text.trim() || isSystemMessage(text)) return;
  
  const suffix = getSystemInfoSuffix();
  
  if (input.isContentEditable) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, suffix);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    input.value += suffix;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  input.dataset.systemInfoAdded = 'true';
  setTimeout(() => { delete input.dataset.systemInfoAdded; }, 100);
}

function setupSendInterception() {
  // 1. Перехват клика по кнопкам отправки (точные селекторы)
  document.body.addEventListener('click', (e) => {
    // Ищем кнопку отправки: в обычном режиме div._52c986b, в режиме редактирования div.ds-basic-button--primary
    const sendBtn = e.target.closest(
      'button[aria-label="Send"], button[aria-label="Отправить"], button[title="Отправить"], ' +
      'div[role="button"].ds-basic-button--primary, ' +   // Send в режиме редактирования
      'div[role="button"]._52c986b'                       // стрелка в обычном режиме
    );
    if (!sendBtn || sendBtn.getAttribute('aria-disabled') === 'true') return;
    // Исключаем наши кастомные кнопки
    if (sendBtn.closest('#ext-commands-toggle') || sendBtn.closest('#ext-insert-prompt')) return;

    let input = null;
    const editContainer = sendBtn.closest('.ds-textarea');
    if (editContainer) {
      input = editContainer.querySelector('textarea');
    }
    if (!input) {
      input = findChatInput();
    }
    if (input) addSystemInfoToInput(input);
  }, true);

  // 2. Перехват Enter остаётся без изменений
  document.body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;

    let input = null;
    // а) Режим редактирования
    const editTextarea = document.querySelector('.ds-textarea textarea');
    if (editTextarea && editTextarea.offsetParent !== null) {
      input = editTextarea;
    }
    // б) Обычный режим
    if (!input) {
      const editable = document.querySelector('div[contenteditable="true"][role="textbox"]');
      if (editable && editable.offsetParent !== null) {
        input = editable;
      }
    }
    // в) Запасные варианты
    if (!input) {
      const chatTextarea = document.querySelector('textarea[placeholder*="DeepSeek"], textarea[placeholder*="Сообщение"], textarea[placeholder*="Message"]');
      if (chatTextarea && chatTextarea.offsetParent !== null) {
        input = chatTextarea;
      }
    }
    if (!input) return;

    addSystemInfoToInput(input);
  }, true);
}

// ========== ОБРАБОТКА КОМАНД ==========
async function processCommands(container) {
  const statuses = [];
  if (!commandsEnabled) return statuses;

  const html = getVisibleHTML(container);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const codeBlocks = doc.querySelectorAll('.md-code-block');
  
  for (const block of codeBlocks) {
    const langSpan = block.querySelector('.d813de27');
    if (!langSpan) continue;
    const lang = langSpan.textContent.trim();
    const codeEl = block.querySelector('pre');
    const code = codeEl ? codeEl.textContent : '';

    if (lang === 'now') {
      statuses.push(`⏰ Текущая дата и время: ${new Date().toLocaleString()}`);
    }
    else if (lang === 'facts') {
      statuses.push(`📋 Сохранённые факты:\n${getFactsList()}`);
    }
    else if (lang === 'clear_all_facts') {
      statuses.push(clearFacts());
    }
    else if (lang === 'export_facts') {
      try {
        const blob = new Blob([JSON.stringify(facts, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `deepseek-facts-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        statuses.push('📦 Факты экспортированы в JSON');
      } catch (e) {
        statuses.push('❌ Ошибка экспорта фактов');
      }
    }
    else if (lang === 'save') {
      const factText = code.trim();
      if (factText) statuses.push(addFact(factText));
    }
    else if (lang.startsWith('delete_fact:')) {
      const factId = lang.substring('delete_fact:'.length).trim();
      if (factId) {
        statuses.push(deleteFact(factId));
      } else {
        statuses.push('❌ Укажите ID факта после delete_fact:');
      }
    }
    else if (lang === 'exec') {
      const res = await executeJS(code);
      if (res.success) {
        statuses.push(`⚡ JS-код выполнен: ${res.result}`);
      } else {
        statuses.push(`❌ Ошибка JS: ${res.error}`);
      }
    }
    else if (lang === 'show') {
      const res = await executeJS(JSON.stringify(code));
      if (res.success) {
        showPopup(res.result);
        statuses.push(`🖼 Визуальный вывод отображён (show)`);
      } else {
        statuses.push(`❌ Ошибка show: ${res.error}`);
      }
    }
    else if (lang === 'send') {
      if (code.trim()) {
        sendAsUser(code.trim());
        statuses.push(`📨 Отправлено: "${code.trim().slice(0, 50)}${code.trim().length > 50 ? '...' : ''}"`);
      }
    }
    else if (lang === 'new_chat') {
      const instructions = code.trim();
      if (!instructions) {
        statuses.push('❌ Команда new_chat требует текст инструкций.');
        continue;
      }
      try {
        const systemPrompt = await getPromptText();
        const finalMessage = systemPrompt + '\n\n' + instructions;
        const newInput = await openNewChat();
        await insertTextAndSend(newInput, finalMessage);
        showNotification('🔄 Новый чат открыт и инструкции переданы.');
      } catch (e) {
        statuses.push(`❌ Ошибка new_chat: ${e.message}`);
      }
    }
  }
  return statuses;
}

// Возвращает HTML-строку клонированного сообщения без «мыслей»
function getVisibleHTML(container) {
  const clone = container.cloneNode(true);
  const thinkBlocks = clone.querySelectorAll('.ds-think-content, [class*="think"]');
  thinkBlocks.forEach(b => b.remove());
  return clone.innerHTML;
}

// ========== УМНОЕ ОЖИДАНИЕ ==========
function waitForCompletion(container, callback) {
  let timer = null;
  let resolved = false;

  const finish = () => {
    if (resolved) return;
    resolved = true;
    observer.disconnect();
    clearTimeout(timer);
    callback();
  };

  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(finish, 2000);
  });

  observer.observe(container, { childList: true, subtree: true, characterData: true });
  timer = setTimeout(finish, 2500);
}

// ========== ОБРАБОТЧИК СООБЩЕНИЯ ==========
async function handleMessage(container) {
  if (container.dataset.processing === 'true' || container.dataset.processed === 'true') return;

  container.dataset.processing = 'true';
  await new Promise(resolve => waitForCompletion(container, resolve));
  container.dataset.processing = 'false';

  const text = container.innerText || container.textContent || '';
  if (!text) return;

  if (text.startsWith('[СИСТЕМНОЕ СООБЩЕНИЕ]')) {
    container.dataset.processed = 'true';
    return;
  }

  const hash = hashText(text);
  if (processedHashes.has(hash)) {
    container.dataset.processed = 'true';
    return;
  }

  const statuses = await processCommands(container);

  if (statuses.length > 0) {
    sendAsUser(statuses.join('\n'));
  }

  processedHashes.add(hash);
  saveProcessedHashes();
  container.dataset.processed = 'true';
}

// ========== ПОМЕТКА СУЩЕСТВУЮЩИХ ==========
function markExisting() {
  document.querySelectorAll('.ds-message, [data-testid="message"], [class*="Message"]').forEach(c => {
    c.dataset.processed = 'true';
  });
}

// ========== НАБЛЮДАТЕЛЬ ==========
function startObserving() {
  markExisting();

  const messageSelector = '.ds-message, [data-testid="message"], [class*="Message"]';

  new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        const messages = [];
        if (node.matches?.(messageSelector)) messages.push(node);
        if (node.querySelectorAll) messages.push(...node.querySelectorAll(messageSelector));

        messages.forEach(msg => {
          if (msg.dataset.processed !== 'true' && msg.dataset.processing !== 'true') {
            handleMessage(msg);
          }
        });
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// ========== ЗАПУСК ==========
window.addEventListener('load', async () => {
  await loadData();
  document.querySelectorAll('[data-processing="true"]').forEach(el => delete el.dataset.processing);
  
  // Внедряем кнопки и наблюдатель
  injectButtons();
  startInjectObserver();
  setupSendInterception();

  startObserving();
});