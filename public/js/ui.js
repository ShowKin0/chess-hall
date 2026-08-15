/* ============ UI 工具 ============ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showView(name) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  const el = $('#view-' + name);
  if (el) el.classList.add('active');
  window.currentView = name;
  onViewShown(name);
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function showModal(title, body, actions = []) {
  $('#modal-title').textContent = title;
  $('#modal-body').textContent = body;
  const box = $('#modal-actions');
  box.innerHTML = '';
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.className = a.cls || '';
    b.onclick = () => {
      hideModal();
      a.onClick && a.onClick();
    };
    box.appendChild(b);
  });
  $('#modal').classList.remove('hidden');
}

function hideModal() {
  $('#modal').classList.add('hidden');
}

function confirmModal(title, body, onAccept, onReject) {
  showModal(title, body, [
    { label: '拒绝', cls: 'btn-reject', onClick: onReject || (() => {}) },
    { label: '接受', cls: 'btn-accept', onClick: onAccept },
  ]);
}

function setButtonState(btn, disabled) {
  if (!btn) return;
  btn.disabled = disabled;
  btn.style.opacity = disabled ? 0.5 : 1;
}
