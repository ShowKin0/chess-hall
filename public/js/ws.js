/* ============ WebSocket 连接与消息分发 ============ */
let ws = null;
let reconnectTimer = null;
let connected = false;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host);

  ws.onopen = () => {
    connected = true;
    console.log('[ws] connected');
    if (window.onWSOpen) onWSOpen();
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (window.onWSMessage) onWSMessage(msg);
  };

  ws.onclose = () => {
  if (window.onWSClose) onWSClose();
    connected = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWS, 1500);
  };

  ws.onerror = (e) => {
    console.warn('[ws] error', e);
  };
}

function sendMsg(obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}
