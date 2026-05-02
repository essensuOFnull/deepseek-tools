// ========== ХРАНИЛИЩЕ ФАКТОВ И ХЕШЕЙ ==========
let facts = [];
let processedHashes = new Set();

function loadData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['deepseek_facts', 'processed_hashes'], (result) => {
      facts = result.deepseek_facts ? JSON.parse(result.deepseek_facts) : [];
      processedHashes = result.processed_hashes ? new Set(JSON.parse(result.processed_hashes)) : new Set();
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

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
}

// ========== ФАКТЫ ==========
function addFact(text) {
  facts.push({ timestamp: new Date().toISOString(), text });
  saveFacts();
  return `✅ Факт сохранён: "${text}" (всего ${facts.length})`;
}

function deleteFact(index) {
  if (index >= 1 && index <= facts.length) {
    facts.splice(index - 1, 1);
    saveFacts();
    return `🗑 Факт #${index} удалён (осталось ${facts.length})`;
  }
  return `❌ Неверный номер факта: ${index}`;
}

function clearFacts() {
  facts = [];
  saveFacts();
  return '🧹 Все факты удалены';
}

function getFactsList() {
  if (!facts.length) return 'нет сохранённых фактов.';
  return facts.map((f, i) => `${i + 1}. [${f.timestamp}] ${f.text}`).join('\n');
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
  // Удаляем предыдущее окно, если есть
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

  // Закрытие по клику на фон
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ========== ПОЛЕ ВВОДА ==========
function findChatInput() {
  const editable = document.querySelector('div[contenteditable="true"][role="textbox"]');
  if (editable) return editable;

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

function waitForSendButtonAndClick(input) {
  const maxAttempts = 15;
  let attempts = 0;

  const tryToSend = () => {
    const sendBtn = document.querySelector(
      'button[aria-label="Send"], button[data-testid="send-button"], ' +
      'button[aria-label="Отправить"], button[title="Отправить"]'
    );

    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      return;
    }

    if (attempts++ < maxAttempts) {
      setTimeout(tryToSend, 100);
    } else {
      const eventOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
      input.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
      input.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
      input.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
    }
  };

  tryToSend();
}

// ========== ВЫПОЛНЕНИЕ JS (общая функция) ==========
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

// ========== ОБРАБОТКА КОМАНД ==========
async function processCommands(container) {
  const statuses = [];

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

    // Простые команды (без аргументов)
    if (lang === 'now') {
      statuses.push(`⏰ Текущая дата и время: ${new Date().toLocaleString()}`);
    }
    else if (lang === 'facts') {
      statuses.push(`📋 Сохранённые факты:\n${getFactsList()}`);
    }
    else if (lang === 'clear:f') {
      statuses.push(clearFacts());
    }
    else if (lang === 'export:f') {
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
    // Команды с аргументом (текст из блока как параметр)
    else if (lang === 'save') {
      const factText = code.trim();
      if (factText) statuses.push(addFact(factText));
    }
    else if (lang === 'delete_fact') {
      const n = parseInt(code.trim());
      statuses.push(deleteFact(n));
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

  // Теперь используем container напрямую для извлечения HTML
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

  const statuses = await processCommands(container); // передаём сам контейнер

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
    // Просто помечаем все существующие как обработанные, без хеширования
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
  startObserving();
});