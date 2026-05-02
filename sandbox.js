// sandbox.js
window.addEventListener('message', (event) => {
  // Проверяем источник — сообщение должно прийти от content script через iframe
  if (event.source !== window.parent) return;
  const { id, code } = event.data;
  try {
    const result = eval(code);
    window.parent.postMessage({ id, success: true, result }, '*');
  } catch (e) {
    window.parent.postMessage({ id, success: false, error: e.message }, '*');
  }
});