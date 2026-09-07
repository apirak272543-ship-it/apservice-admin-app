(() => {
  'use strict';

  const M = window.APServiceMPA;
  if (!M) return;

  const esc = value => M.ui.escapeHtml(String(value ?? '')); const stableJson = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item).sort().reduce((out, key) => { out[key] = item[key]; return out; }, {}) : item);
  const money = value => M.ui.baht(Number(value || 0));
  const iso = () => M.ui.nowIso();
  const request = (path, options = {}) => M.request(path, { private: true, ...options });
  const runtime = () => window.APServiceAdminRuntime;
  const notice = (message, type) => M.ui.setNotice(message, type);
  const override = () => window.APServiceAdminOverride;
  async function manageOrder(order, operation, data, reason, evidencePath = '') {
    const session = await M.auth.refreshSession(false);
    if (!session?.access_token) throw new Error('เซสชันแอดมินหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `order-control-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch(`${M.config.url}/functions/v1/role-access`, { method: 'POST', headers: { apikey: M.config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'manage_delivery_order', order_id: order.id, operation, data, reason, evidence_path: evidencePath || '', idempotency_key: idempotencyKey }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'ไม่สามารถบันทึกการจัดการออร์เดอร์ได้');
    return result;
  }
  async function resolveCancellation(requestId, decision, reason, refundDecision, evidencePath = '') {
    const session = await M.auth.refreshSession(false);
    if (!session?.access_token) throw new Error('เซสชันแอดมินหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const key = crypto.randomUUID ? crypto.randomUUID() : `cancel-review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch(`${M.config.url}/functions/v1/role-access`, { method: 'POST', headers: { apikey: M.config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resolve_order_cancellation', request_id: requestId, decision, reason, refund_decision: refundDecision, idempotency_key: key, evidence_path: evidencePath || '' }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'ไม่สามารถบันทึกผลพิจารณาการยกเลิกได้');
    return result;
  }

  const legacyNewStatuses = new Set(['รอดำเนินการ', 'รอชำระเงิน', 'รอตรวจสอบ', 'pending']);
  const legacyHistoryStatuses = new Set(['สำเร็จแล้ว', 'เสร็จสิ้น', 'ยกเลิก', 'ถูกยกเลิก', 'ระงับแล้ว', 'ถูกระงับ', 'completed', 'cancelled', 'canceled', 'suspended']);
  const statusLabel = status => ({ completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก', canceled: 'ยกเลิก', suspended: 'ระงับแล้ว' }[String(status || '').toLowerCase()] || String(status || 'ไม่ระบุ'));
  const canonicalStatuses = () => runtime()?.C?.contracts?.orderStatus || window.APServiceCore?.contracts?.orderStatus || {};
  const isHistory = status => { const value = String(status || '').trim().toLowerCase(); const C = canonicalStatuses(); return status === C.COMPLETED || status === C.CANCELLED || legacyHistoryStatuses.has(String(status || '').trim()) || legacyHistoryStatuses.has(value) || value.includes('completed') || value.includes('cancel') || value.includes('suspend') || value.includes('สำเร็จ') || value.includes('ยกเลิก') || value.includes('ระงับ'); };
  const orderBucket = status => { const C = canonicalStatuses(); if (isHistory(status)) return 'history'; if ([C.PAYMENT_REVIEW, C.PAYMENT_RETRY, C.CREDIT_REVIEW].includes(status) || legacyNewStatuses.has(String(status || '').trim())) return 'new'; return 'active'; };

  async function audit(action, targetUserId, reason, beforeState, afterState) {
    const user = runtime()?.user;
    if (!user?.id) return;
    try {
      await request('admin_action_audit', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ actor_id: user.id, target_user_id: targetUserId || null, action, reason: reason || null, before_state: beforeState || null, after_state: afterState || null, created_at: iso() }) });
    } catch (error) {
      console.warn('บันทึก admin audit ไม่สำเร็จ', error);
    }
  }

  function modal(title, body, aria = title) {
    const backdrop = document.createElement('div');
    backdrop.className = 'mpa-modal-backdrop';
    backdrop.innerHTML = `<section class="mpa-card mpa-modal" role="dialog" aria-modal="true" aria-label="${esc(aria)}"><div class="mpa-page-head"><div><h2 style="margin:0">${esc(title)}</h2></div><button type="button" class="mpa-button mpa-button-secondary" data-close>ปิด</button></div>${body}</section>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-close]').forEach(button => { button.onclick = close; });
    return { backdrop, close };
  }

  function dashboardPatch() {
    const R = runtime();
    if (!R) return;
    const content = `<div class="mpa-page-head"><div><h1>ภาพรวมงานหลังบ้าน</h1><p>ศูนย์ควบคุมออเดอร์ ร้านค้า สื่อโฆษณา และบัญชีทุกบทบาท</p></div><button class="mpa-button mpa-button-secondary" id="signOut">ออกจากระบบ</button></div><section class="admin-quick-actions" aria-label="ทางลัดงานสำคัญ"><a href="orders.html" class="admin-quick-action">${R.icon('orders')}<span>จัดการออเดอร์และประวัติ</span></a><a href="stores.html" class="admin-quick-action">${R.icon('stores')}<span>ร้านค้าและหมวดหมู่</span></a><a href="media.html" class="admin-quick-action">${R.icon('promotions')}<span>ศูนย์สื่อโฆษณา</span></a><a href="coupons.html" class="admin-quick-action">${R.icon('coupons')}<span>จัดการคูปอง</span></a><a href="accounts.html" class="admin-quick-action">${R.icon('account')}<span>บัญชีทุกบทบาท</span></a><a href="finance.html" class="admin-quick-action">${R.icon('finance')}<span>ตรวจการเงิน</span></a><a href="riders.html" class="admin-quick-action">${R.icon('riders')}<span>จัดการ ไรเดอร์</span></a></section><div class="mpa-grid stats" id="stats">${M.ui.loading('กำลังสรุปงานค้าง…')}</div><section class="mpa-card" style="margin-top:18px"><h2 style="margin-top:0">งานที่ต้องตรวจสอบ</h2><div id="pending"><p class="mpa-muted">เลือกเมนูด้านบนเพื่อจัดการข้อมูลแต่ละประเภท ระบบไม่รวมออเดอร์ที่ปิดแล้วไว้ในคิวงานปัจจุบัน</p></div></section>`;
    R.gate('dashboard', content).then(async access => {
      if (!access) return;
      R.user = access.user;
      document.querySelector('#signOut')?.remove();
      const count = async path => { try { return await M.requestCount(path, { private: true }); } catch (_) { return 0; } };
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0); const fetchRows = async path => { try { return await M.request(path, { private: true, cacheTtlMs: 15000 }); } catch (_) { return []; } }; const [orders, stores, riders, withdrawals, todayOrders, settlementRows] = await Promise.all([
        count('delivery_orders?select=id&status=neq.สำเร็จแล้ว'),
        count('stores?select=id&active=eq.true'),
        count('riders?select=id&status=eq.พร้อมรับงาน'),
        count('withdrawal_requests?select=id&status=eq.pending'),
        fetchRows(`delivery_orders?select=id,total,payable,ordered_at,status&ordered_at=gte.${encodeURIComponent(dayStart.toISOString())}&limit=500`),
        fetchRows('settlements?select=gross_amount,gp_amount,net_amount,status&limit=500')
      ]); const todaySales = (todayOrders || []).filter(row => !isHistory(row.status)).reduce((sum, row) => sum + Number(row.payable ?? row.total ?? 0), 0); const platformGross = (settlementRows || []).reduce((sum, row) => sum + Number(row.gp_amount || 0), 0); const platformNet = (settlementRows || []).filter(row => !['cancelled','canceled','void'].includes(String(row.status || '').toLowerCase())).reduce((sum, row) => sum + Number(row.net_amount || 0), 0);
      const stats = document.querySelector('#stats');
      if (stats) stats.innerHTML = `<a class="mpa-card mpa-stat admin-stat-link" href="finance.html"><small>ยอดขายวันนี้</small><strong>${money(todaySales)}</strong><span>ดูการเงิน</span></a><a class="mpa-card mpa-stat admin-stat-link" href="finance.html"><small>รายได้แพลตฟอร์มจาก GP</small><strong>${money(platformGross)}</strong><span>ตรวจรายได้</span></a><a class="mpa-card mpa-stat admin-stat-link" href="finance.html"><small>เงินคงคลังสุทธิจาก settlement</small><strong>${money(platformNet)}</strong><span>ดู settlement</span></a><a class="mpa-card mpa-stat admin-stat-link" href="finance.html"><small>คำขอถอนเงินรอตรวจ</small><strong>${withdrawals}</strong><span>เปิดการเงิน</span></a><a class="mpa-card mpa-stat admin-stat-link" href="orders.html"><small>ออร์เดอร์ที่ยังดำเนินการ</small><strong>${orders}</strong><span>เปิดออร์เดอร์</span></a><a class="mpa-card mpa-stat admin-stat-link" href="stores.html"><small>ร้านค้าเปิดบริการ</small><strong>${stores}</strong><span>เปิดร้านค้า</span></a><a class="mpa-card mpa-stat admin-stat-link" href="riders.html"><small>ไรเดอร์พร้อมรับงาน</small><strong>${riders}</strong><span>เปิดไรเดอร์</span></a>`;
    }).catch(error => notice(error.message, 'error'));
  }

  async function fetchOrderItems(orderId) {
    return request(`delivery_order_items?select=id,order_id,item_id,name,emoji,unit_price,quantity,options&order_id=eq.${encodeURIComponent(orderId)}&order=id.asc&limit=200`);
  }

  async function fetchไรเดอร์s() {
    return request('riders?select=id,name,phone,status,ride_available,compliance_status&order=name.asc&limit=250');
  }

  function orderItemEditor(order, onSaved) {
    let rows = [];
    const body = `<p class="mpa-muted">แก้ไขชื่อ ราคา จำนวน และตัวเลือกของรายการเดิมได้ พร้อมเพิ่มรายการกำหนดเองโดยไม่ลบออเดอร์เดิม</p><div id="orderItemRows" class="mpa-grid"></div><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:14px"><button type="button" class="mpa-button mpa-button-secondary" id="addOrderItem">เพิ่มรายการ</button><strong id="orderItemTotal">ยอดสินค้า ${money(0)}</strong></div>${override().fields('order-items', { label: 'เหตุผลการแก้ไขรายการ', financial: true })}<div class="admin-modal-actions"><button type="button" class="mpa-button mpa-button-secondary" data-close>ยกเลิก</button><button type="button" class="mpa-button" id="saveOrderItems">บันทึกรายการและคำนวณยอดใหม่</button></div>`;
    const dialog = modal(`แก้ไขรายการออเดอร์ ${order.id}`, body, 'แก้ไขรายการออเดอร์');
    const render = () => {
      const host = dialog.backdrop.querySelector('#orderItemRows');
      if (!host) return;
      host.innerHTML = rows.length ? rows.map((row, index) => `<div class="mpa-card" style="box-shadow:none;border:1px solid var(--ap-line)"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>${esc(row.emoji || '🍽️')} รายการที่ ${index + 1}</strong>${row.id ? '' : '<span class="mpa-badge">รายการใหม่</span>'}</div><div class="admin-form-grid" style="margin-top:10px"><label class="mpa-field"><span>ชื่อรายการ</span><input data-item="name" data-index="${index}" value="${esc(row.name)}"></label><label class="mpa-field"><span>Emoji</span><input data-item="emoji" data-index="${index}" maxlength="12" value="${esc(row.emoji || '🍽️')}"></label><label class="mpa-field"><span>ราคา/หน่วย</span><input data-item="unit_price" data-index="${index}" type="number" min="0" step="0.01" value="${Number(row.unit_price || 0)}"></label><label class="mpa-field"><span>จำนวน</span><input data-item="quantity" data-index="${index}" type="number" min="1" step="1" value="${Math.max(1, Number(row.quantity || 1))}"></label><button type="button" class="mpa-button mpa-button-danger" data-remove-item="${index}">ลบรายการนี้</button></div></div>`).join('') : '<p class="mpa-muted">ยังไม่มีรายการในออเดอร์ กดเพิ่มรายการเพื่อสร้างรายการใหม่</p>';
      host.querySelectorAll('[data-item]').forEach(input => { input.oninput = () => { const row = rows[Number(input.dataset.index)]; const field = input.dataset.item; row[field] = field === 'unit_price' || field === 'quantity' ? Number(input.value) : input.value; updateTotal(); }; });
      host.querySelectorAll('[data-remove-item]').forEach(button => { button.onclick = () => { rows.splice(Number(button.dataset.removeItem), 1); render(); }; });
      updateTotal();
    };
    const updateTotal = () => { const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.unit_price || 0)) * Math.max(0, Number(row.quantity || 0)), 0); const node = dialog.backdrop.querySelector('#orderItemTotal'); if (node) node.textContent = `ยอดสินค้า ${money(total)}`; };
    dialog.backdrop.querySelector('#addOrderItem').onclick = () => { rows.push({ id: null, order_id: order.id, item_id: null, name: '', emoji: '🍽️', unit_price: 0, quantity: 1, options: {} }); render(); };
    dialog.backdrop.querySelector('#saveOrderItems').onclick = async () => {
      if (rows.some(row => !String(row.name || '').trim() || !Number.isFinite(Number(row.unit_price)) || Number(row.unit_price) < 0 || !Number.isInteger(Number(row.quantity)) || Number(row.quantity) < 1)) return notice('กรุณากรอกชื่อ ราคา และจำนวนให้ถูกต้องทุกแถว', 'error');
      let decision; try { decision = await override().collect(dialog.backdrop, 'order-items', `คุณกำลังแก้ไขรายการและยอดชำระของออร์เดอร์ ${order.id}`); } catch (error) { return notice(error.message || 'ยืนยันการแก้ไขไม่สำเร็จ', 'error'); }
      const save = dialog.backdrop.querySelector('#saveOrderItems'); save.disabled = true;
      try {
        await manageOrder(order, 'items', { items: rows.map(row => ({ id: row.id || null, item_id: row.item_id || null, name: String(row.name).trim(), emoji: String(row.emoji || '🍽️').trim(), unit_price: Number(row.unit_price), quantity: Number(row.quantity), options: row.options || {} })) }, decision.reason, decision.evidencePath);
        notice('บันทึกรายการออร์เดอร์และคำนวณยอดใหม่แล้ว'); dialog.close(); onSaved();
      } catch (error) { save.disabled = false; notice(`บันทึกรายการไม่สำเร็จ: ${error.message}`, 'error'); }
    };
    fetchOrderItems(order.id).then(data => { rows = (data || []).map(row => ({ ...row, unit_price: Number(row.unit_price || 0), quantity: Math.max(1, Number(row.quantity || 1)) })); render(); }).catch(error => { notice(`โหลดรายการไม่สำเร็จ: ${error.message}`, 'error'); dialog.close(); });
  }

  function orderHistory(order) {
    const body = `<div id="orderHistoryBody">${M.ui.loading('กำลังโหลดประวัติออเดอร์…')}</div>`;
    const dialog = modal(`ประวัติออเดอร์ ${order.id}`, body, 'ประวัติออเดอร์');
    request(`order_status_events?select=status,actor_id,actor_label,created_at&order_id=eq.${encodeURIComponent(order.id)}&order=created_at.desc&limit=100`).then(rows => {
      const host = dialog.backdrop.querySelector('#orderHistoryBody');
      if (!host) return;
      host.innerHTML = rows?.length ? `<div class="mpa-table-wrap"><table class="mpa-table"><thead><tr><th>เวลา</th><th>สถานะ</th><th>ผู้ดำเนินการ</th></tr></thead><tbody>${rows.map(row => `<tr><td>${row.created_at ? esc(new Date(row.created_at).toLocaleString('th-TH')) : '-'}</td><td><span class="mpa-badge">${esc(statusLabel(row.status))}</span></td><td>${esc(row.actor_label || row.actor_id || '-')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mpa-muted">ยังไม่มีประวัติสถานะที่บันทึกไว้</p>';
    }).catch(error => { const host = dialog.backdrop.querySelector('#orderHistoryBody'); if (host) host.innerHTML = M.ui.error('โหลดประวัติไม่สำเร็จ', error.message); });
  }

  async function cancellationReview(order, onSaved) {
    const requests = await request(`order_cancellation_requests?select=id,reason,evidence,status,created_at,requester_role&order_id=eq.${encodeURIComponent(order.id)}&status=eq.requested&order=created_at.desc&limit=1`);
    const cancellation = requests?.[0];
    if (!cancellation) return notice('ออร์เดอร์นี้ไม่มีคำขอยกเลิกที่รอพิจารณา', 'error');
    const payments = await request(`order_payments?select=id,method,expected_amount,captured_amount,status&order_id=eq.${encodeURIComponent(order.id)}&limit=1`);
    const payment = payments?.[0] || {};
    const evidence = cancellation.evidence && typeof cancellation.evidence === 'object' ? JSON.stringify(cancellation.evidence) : '-';
    const body = `<dl class="admin-withdrawal-review-grid"><div><dt>ออร์เดอร์</dt><dd>${esc(order.id)}</dd></div><div><dt>ลูกค้า</dt><dd>${esc(order.customer_name || '-')}</dd></div><div><dt>ร้านค้า</dt><dd>${esc(order.store_name || '-')}</dd></div><div><dt>สถานะปัจจุบัน</dt><dd>${esc(statusLabel(order.status))}</dd></div><div><dt>วิธีชำระ</dt><dd>${esc(payment.method || '-')}</dd></div><div><dt>ยอดที่ต้องชำระ</dt><dd>${money(payment.expected_amount ?? order.payable ?? order.total)}</dd></div><div><dt>สถานะการชำระ</dt><dd>${esc(payment.status || '-')}</dd></div><div><dt>ผู้ขอ</dt><dd>${esc(cancellation.requester_role || 'customer')}</dd></div></dl><label class="mpa-field"><span>เหตุผลจากผู้ขอ</span><textarea rows="3" disabled>${esc(cancellation.reason || '-')}</textarea></label><label class="mpa-field"><span>หลักฐาน/บริบท</span><textarea rows="2" disabled>${esc(evidence)}</textarea></label><label class="mpa-field"><span>ผลพิจารณา</span><select id="cancellationDecision"><option value="approve_no_refund">อนุมัติยกเลิก (ไม่เปิดคำขอคืนเงิน)</option><option value="approve_refund_pending">อนุมัติยกเลิกและเปิดคำขอคืนเงิน</option><option value="reject">ปฏิเสธคำขอยกเลิก</option></select></label>${override().fields('cancellation', { label: 'เหตุผลผลพิจารณา', financial: true, placeholder: 'ระบุผลที่ตรวจสอบและเหตุผลการอนุมัติหรือปฏิเสธ' })}<div class="admin-modal-actions"><button type="button" class="mpa-button mpa-button-secondary" data-close>ยกเลิก</button><button type="button" class="mpa-button" id="saveCancellationDecision">บันทึกผลพิจารณา</button></div>`;
    const dialog = modal(`พิจารณายกเลิก · ${order.id}`, body, 'พิจารณาคำขอยกเลิกออร์เดอร์');
    dialog.backdrop.querySelector('#saveCancellationDecision').onclick = async () => {
      const choice = dialog.backdrop.querySelector('#cancellationDecision')?.value || '';
      const button = dialog.backdrop.querySelector('#saveCancellationDecision'); button.disabled = true;
      const decision = choice === 'reject' ? 'reject' : 'approve'; const refundDecision = choice === 'approve_refund_pending' ? 'refund_pending' : 'no_refund';
      try { const governance = await override().collect(dialog.backdrop, 'cancellation', `คุณกำลัง${decision === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}คำขอยกเลิกของออร์เดอร์ ${order.id}`); await resolveCancellation(cancellation.id, decision, governance.reason, refundDecision, governance.evidencePath); notice(refundDecision === 'refund_pending' ? 'อนุมัติยกเลิกและเปิดคำขอคืนเงินแล้ว' : (decision === 'reject' ? 'ปฏิเสธคำขอยกเลิกแล้ว' : 'อนุมัติยกเลิกแล้ว')); dialog.close(); onSaved(); }
      catch (error) { button.disabled = false; notice(`บันทึกผลพิจารณาไม่สำเร็จ: ${error.message}`, 'error'); }
    };
  }

  function riderAssignment(order, onSaved) {
    const body = `<label class="mpa-field"><span>เลือก ไรเดอร์</span><select id="riderSelect"><option value="">กำลังโหลด ไรเดอร์…</option></select></label>${override().fields('rider-assignment', { label: 'เหตุผลการมอบหมายหรือยกเลิก ไรเดอร์', placeholder: 'เช่น รถเดิมขัดข้องและ ไรเดอร์ คนใหม่อยู่ใกล้จุดรับ' })}<div class="admin-modal-actions"><button type="button" class="mpa-button mpa-button-secondary" data-close>ยกเลิก</button><button type="button" class="mpa-button" id="saveไรเดอร์">บันทึกการมอบหมาย</button></div>`;
    const dialog = modal(`มอบหมาย ไรเดอร์ · ${order.id}`, body, 'มอบหมาย ไรเดอร์');
    const select = dialog.backdrop.querySelector('#riderSelect');
    fetchไรเดอร์s().then(rows => {
      if (!select) return;
      const available = (rows || []).filter(row => row.status === 'พร้อมรับงาน' || row.ride_available === true || row.id === order.rider_id);
      select.innerHTML = `<option value="">ยังไม่มอบหมาย</option>${available.map(row => `<option value="${esc(row.id)}" ${row.id === order.rider_id ? 'selected' : ''}>${esc(row.name || row.phone || row.id)} · ${esc(row.status || (row.ride_available ? 'พร้อมรับงาน' : 'ไม่ระบุ'))}</option>`).join('')}`;
    }).catch(error => { if (select) select.innerHTML = `<option value="">โหลด ไรเดอร์ ไม่สำเร็จ</option>`; notice(error.message, 'error'); });
    dialog.backdrop.querySelector('#saveไรเดอร์').onclick = async () => {
      const riderId = select?.value || null; const row = (await fetchไรเดอร์s()).find(item => item.id === riderId);
      const save = dialog.backdrop.querySelector('#saveไรเดอร์'); save.disabled = true;
      try { const governance = await override().collect(dialog.backdrop, 'rider-assignment', `คุณกำลัง${riderId ? `มอบหมายงานให้ ${row?.name || 'ไรเดอร์'}` : 'ยกเลิกการมอบหมาย ไรเดอร์'} สำหรับออร์เดอร์ ${order.id}`); await manageOrder(order, 'assign_rider', { rider_id: riderId }, governance.reason, governance.evidencePath); notice(riderId ? `มอบหมายงานให้ ${row?.name || 'ไรเดอร์'} แล้ว` : 'ยกเลิกการมอบหมาย ไรเดอร์ แล้ว'); dialog.close(); onSaved(); } catch (error) { save.disabled = false; notice(`บันทึก ไรเดอร์ ไม่สำเร็จ: ${error.message}`, 'error'); }
    };
  }

  function adminOrderCoreEditor(order, onSaved) {
    const body = `<p class="mpa-muted">ผู้ดูแลระบบสามารถแก้ไขข้อมูลหลักของออเดอร์ได้ทุกส่วนที่เปิดให้แก้ไข ระบบจะบันทึกเหตุผลและประวัติการดำเนินการทุกครั้ง</p><div class="admin-form-grid"><label class="mpa-field"><span>ชื่อลูกค้า/ผู้รับ</span><input id="adminOrderCustomer" value="${esc(order.customer_name || '')}" required></label><label class="mpa-field"><span>ชื่อร้านค้า</span><input id="adminOrderStore" value="${esc(order.store_name || '')}" required></label><label class="mpa-field"><span>วิธีชำระเงิน</span><input id="adminOrderPayment" value="${esc(order.payment_method || '')}" placeholder="เช่น เงินสด โอน หรือบัตร"></label><label class="mpa-field"><span>ค่าจัดส่ง</span><input id="adminOrderDeliveryFee" type="number" min="0" step="0.01" value="${esc(order.delivery_fee ?? 0)}"></label><label class="mpa-field"><span>เครดิตที่ใช้</span><input id="adminOrderCredit" type="number" min="0" step="0.01" value="${esc(order.credit_used ?? 0)}"></label><label class="mpa-field admin-form-full"><span>หมายเหตุการจัดส่ง</span><textarea id="adminOrderNote" rows="3">${esc(order.dispatch_note || '')}</textarea></label></div>${override().fields('order-core-edit', { label: 'เหตุผลการแก้ไขข้อมูลหลัก', placeholder: 'เช่น แก้ชื่อผู้รับตามการยืนยันทางโทรศัพท์' })}<div class="admin-modal-actions"><button type="button" class="mpa-button mpa-button-secondary" data-close>ยกเลิก</button><button type="button" class="mpa-button" id="saveAdminOrderCore">บันทึกข้อมูลหลัก</button></div>`;
    const dialog = modal(`แก้ไขข้อมูลหลัก · ${order.id}`, body, 'แก้ไขข้อมูลหลักของออเดอร์');
    dialog.backdrop.querySelector('#saveAdminOrderCore').onclick = async () => {
      const customerName = dialog.backdrop.querySelector('#adminOrderCustomer')?.value.trim();
      const storeName = dialog.backdrop.querySelector('#adminOrderStore')?.value.trim();
      const deliveryFee = Number(dialog.backdrop.querySelector('#adminOrderDeliveryFee')?.value || 0);
      const creditUsed = Number(dialog.backdrop.querySelector('#adminOrderCredit')?.value || 0);
      if (!customerName || !storeName) return notice('กรุณาระบุชื่อลูกค้าและชื่อร้านค้า', 'error');
      if (![deliveryFee, creditUsed].every(value => Number.isFinite(value) && value >= 0)) return notice('ค่าจัดส่งและเครดิตต้องเป็นตัวเลขตั้งแต่ศูนย์ขึ้นไป', 'error');
      const next = { customer_name: customerName, store_name: storeName, payment_method: dialog.backdrop.querySelector('#adminOrderPayment')?.value.trim() || null, delivery_fee: deliveryFee, credit_used: creditUsed, dispatch_note: dialog.backdrop.querySelector('#adminOrderNote')?.value.trim() || null, updated_at: iso() };
      const save = dialog.backdrop.querySelector('#saveAdminOrderCore'); save.disabled = true;
      try { const governance = await override().collect(dialog.backdrop, 'order-core-edit', `คุณกำลังแก้ไขข้อมูลหลักของออเดอร์ ${order.id}`); await request(`delivery_orders?id=eq.${encodeURIComponent(order.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(next) }); await audit('admin_order_core_updated', null, governance.reason, order, next); notice('บันทึกข้อมูลหลักของออเดอร์แล้ว'); dialog.close(); onSaved(); } catch (error) { save.disabled = false; notice(`บันทึกข้อมูลหลักไม่สำเร็จ: ${error.message}`, 'error'); }
    };
  }

  function orderStatusEditor(order, onSaved) {
    const R = runtime();
    const C = R?.C;
    if (!C?.order?.canTransition || !C?.contracts?.orderStatus) return notice('ระบบตรวจขั้นตอนการเปลี่ยนสถานะยังไม่พร้อม กรุณารีเฟรชหน้าแล้วลองใหม่', 'error');
    const candidates = Object.values(C.contracts.orderStatus).filter(status => C.order.canTransition({ from: order.status, to: status, actor: 'admin' }).ok);
    if (!candidates.length) return notice('ออเดอร์นี้อยู่ในสถานะปลายทางแล้ว หรือไม่มีสถานะถัดไปที่อนุญาต', 'error');
    const body = `<p class="mpa-muted">ระบบจะแสดงเฉพาะสถานะถัดไปที่อนุญาต เพื่อให้ลำดับงานถูกต้องและตรวจสอบย้อนหลังได้</p><label class="mpa-field"><span>สถานะปัจจุบัน</span><input value="${esc(statusLabel(order.status))}" disabled></label><label class="mpa-field"><span>เปลี่ยนเป็น</span><select id="nextOrderStatus"><option value="">เลือกสถานะ…</option>${candidates.map(status => `<option value="${esc(status)}">${esc(statusLabel(status))}</option>`).join('')}</select></label>${override().fields('order-status', { label: 'เหตุผลการเปลี่ยนสถานะ', placeholder: 'เช่น ตรวจหลักฐานและยืนยันสถานะจากร้านแล้ว' })}<div class="admin-modal-actions"><button type="button" class="mpa-button mpa-button-secondary" data-close>ยกเลิก</button><button type="button" class="mpa-button" id="saveOrderStatus">บันทึกสถานะ</button></div>`;
    const dialog = modal(`เปลี่ยนสถานะ · ${order.id}`, body, 'เปลี่ยนสถานะออเดอร์');
    dialog.backdrop.querySelector('#saveOrderStatus').onclick = async () => {
      const nextStatus = dialog.backdrop.querySelector('#nextOrderStatus')?.value;
      if (!nextStatus) return notice('กรุณาเลือกสถานะถัดไป', 'error');
      const check = C.order.canTransition({ from: order.status, to: nextStatus, actor: 'admin' });
      if (!check.ok) return notice(check.reason, 'error');
      const save = dialog.backdrop.querySelector('#saveOrderStatus'); save.disabled = true;
      try {
        const governance = await override().collect(dialog.backdrop, 'order-status', `คุณกำลังเปลี่ยนสถานะออร์เดอร์ ${order.id} เป็น ${statusLabel(nextStatus)}`);
        await manageOrder(order, 'status', { status: nextStatus }, governance.reason, governance.evidencePath);
        notice('บันทึกสถานะออเดอร์แล้ว'); dialog.close(); onSaved();
      } catch (error) { save.disabled = false; notice(`บันทึกสถานะไม่สำเร็จ: ${error.message}`, 'error'); }
    };
  }

  function dispatchEditor(order, onSaved) {
    const statuses = [['unassigned', 'ยังไม่มอบหมาย'], ['assigned', 'มอบหมายแล้ว'], ['en_route', 'กำลังไปจุดรับ'], ['arrived_pickup', 'ถึงจุดรับแล้ว'], ['picked_up', 'รับสินค้าแล้ว'], ['delivering', 'กำลังไปส่ง'], ['delivered', 'ส่งสำเร็จ'], ['exception', 'มีเหตุขัดข้อง']];
    const currentStatus = String(order.dispatch_status || (order.rider_id ? 'assigned' : 'unassigned'));
    const currentEta = order.estimated_arrival_at ? new Date(order.estimated_arrival_at) : null;
    const etaMinutes = currentEta && !Number.isNaN(currentEta.getTime()) ? Math.max(0, Math.round((currentEta.getTime() - Date.now()) / 60000)) : '';
    const body = `<p class="mpa-muted">อัปเดตการมอบหมายและ ETA โดยไม่ข้ามหรือเปลี่ยนกฎสถานะออร์เดอร์หลัก ระบบจะบันทึก Event และแจ้ง Customer/ไรเดอร์ เมื่อบันทึกสำเร็จ</p><label class="mpa-field"><span>สถานะ Dispatch</span><select id="dispatchStatus">${statuses.map(([value, label]) => `<option value="${value}" ${value === currentStatus ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="mpa-field"><span>ETA (นาทีจากตอนนี้)</span><input id="dispatchEta" type="number" min="0" max="1440" step="1" value="${etaMinutes}" placeholder="เช่น 25"><span class="mpa-muted">ปล่อยว่างเพื่อเคลียร์เวลา โดยต้องติ๊กตัวเลือกด้านล่าง</span></label><label class="mpa-field" style="display:flex;gap:10px;align-items:center"><input id="dispatchUpdateEta" type="checkbox" ${currentEta ? 'checked' : ''} style="width:auto"><span>บันทึก/เคลียร์ ETA ในครั้งนี้</span></label><label class="mpa-field"><span>หมายเหตุ Dispatch</span><textarea id="dispatchNote" rows="3" maxlength="500" placeholder="เช่น ร้านกำลังเตรียมสินค้า หรือรถติดบริเวณจุดรับ">${esc(order.dispatch_note || '')}</textarea></label>${override().fields('dispatch-eta', { label: 'เหตุผลการอัปเดต Dispatch/ETA', placeholder: 'เช่น ตรวจตำแหน่ง ไรเดอร์ และยืนยันเวลาจากร้านค้าแล้ว' })}<div class="admin-modal-actions"><button type="button" class="mpa-button mpa-button-secondary" data-close>ยกเลิก</button><button type="button" class="mpa-button" id="saveDispatch">บันทึก Dispatch/ETA</button></div>`;
    const dialog = modal(`การจัดส่ง / เวลาถึงโดยประมาณ · ${order.id}`, body, 'อัปเดต Dispatch และ ETA');
    dialog.backdrop.querySelector('#saveDispatch').onclick = async () => {
      const status = dialog.backdrop.querySelector('#dispatchStatus')?.value || 'unassigned';
      const updateEta = Boolean(dialog.backdrop.querySelector('#dispatchUpdateEta')?.checked);
      const rawEta = dialog.backdrop.querySelector('#dispatchEta')?.value?.trim() || '';
      const minutes = rawEta === '' ? null : Number(rawEta);
      const dispatchNote = dialog.backdrop.querySelector('#dispatchNote')?.value?.trim() || '';
      if (updateEta && minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) return notice('ETA ต้องเป็นจำนวนเต็ม 0–1440 นาที', 'error');
      const save = dialog.backdrop.querySelector('#saveDispatch'); save.disabled = true;
      try { const governance = await override().collect(dialog.backdrop, 'dispatch-eta', `คุณกำลังอัปเดต Dispatch/ETA ของออร์เดอร์ ${order.id}`); await manageOrder(order, 'dispatch', { dispatch_status: status, rider_id: order.rider_id || null, eta_minutes: minutes, update_eta: updateEta, dispatch_note: dispatchNote }, governance.reason, governance.evidencePath); notice('บันทึก Dispatch/ETA และแจ้งปลายทางแล้ว'); dialog.close(); onSaved(); } catch (error) { save.disabled = false; notice(`บันทึก Dispatch/ETA ไม่สำเร็จ: ${error.message}`, 'error'); }
    };
  }

  function ordersPatch() {
    const R = runtime();
    if (!R) return;
    const content = `<div class="mpa-page-head"><div><p class="admin-page-eyebrow">ศูนย์ควบคุมออเดอร์</p><h1>จัดการออเดอร์</h1><p>แยกคิวงานตามขั้นตอนจริง ร้านค้าและไรเดอร์สามารถส่งงานเข้ามาได้ และผู้ดูแลระบบมีสิทธิ์แก้ไขสถานะ รายการสินค้า ผู้รับงาน การจัดส่ง และข้อมูลหลักของออเดอร์</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="mpa-button mpa-button-secondary" id="showHistory">ดูประวัติออเดอร์</button><button class="mpa-button mpa-button-secondary" id="refreshOrders">รีเฟรช</button></div></div><section class="mpa-card admin-orders-workspace"><div class="admin-filter-row admin-orders-tabs admin-orders-workflow-tabs" role="tablist" aria-label="Workflow ออเดอร์"><button class="mpa-button" data-order-tab="unhandled" role="tab" aria-selected="true">ใหม่ · ยังไม่จัดการ <span data-order-count="unhandled">0</span></button><button class="mpa-button mpa-button-secondary" data-order-tab="reviewed" role="tab" aria-selected="false">ใหม่ · ตรวจแล้ว <span data-order-count="reviewed">0</span></button><button class="mpa-button mpa-button-secondary" data-order-tab="active" role="tab" aria-selected="false">กำลังดำเนินการ <span data-order-count="active">0</span></button><button class="mpa-button mpa-button-secondary" data-order-tab="completed" role="tab" aria-selected="false">เสร็จสิ้น/ปิดงาน <span data-order-count="completed">0</span></button><label class="mpa-field admin-order-search"><span class="sr-only">ค้นหาออเดอร์</span><input id="orderSearch" placeholder="ค้นหาเลขออเดอร์ ลูกค้า ร้านค้า หรือไรเดอร์"></label><a class="mpa-button mpa-button-secondary admin-orders-notification-link" href="notifications.html">แจ้งเตือนที่ต้องติดตาม <span data-order-notification-count>0</span></a></div><div id="orderStatusFilters" class="admin-order-status-filters" aria-label="กรองตามสถานะ"></div><div id="orders">${M.ui.loading('กำลังโหลดออเดอร์…')}</div></section>`;
    R.gate('orders', content).then(async access => {
      if (!access) return;
      R.user = access.user;
      const host = document.querySelector('#orders'); let rows = []; let tab = 'unhandled'; let search = ''; let statusFilter = 'all'; let notificationCount = 0;
      const statusText = row => statusLabel(row.status);
      const wasTouched = row => { const ordered = Date.parse(row.ordered_at || ''); const updated = Date.parse(row.updated_at || ''); return Number.isFinite(ordered) && Number.isFinite(updated) && updated - ordered > 60 * 1000; };
      const workflowBucket = row => { const bucket = orderBucket(row.status); if (bucket === 'history') return 'completed'; if (bucket === 'new') return wasTouched(row) ? 'reviewed' : 'unhandled'; return 'active'; };
      const workflowInfo = key => ({ unhandled: { label: 'ใหม่ · ยังไม่จัดการ', icon: '!' }, reviewed: { label: 'ใหม่ · ตรวจแล้ว', icon: '✓' }, active: { label: 'กำลังดำเนินการ', icon: '…' }, completed: { label: 'เสร็จสิ้น/ปิดงาน', icon: '✓' } }[key] || { label: 'ไม่ระบุ workflow', icon: '?' });
      const workState = row => { const key = workflowBucket(row); const info = workflowInfo(key); return { key: key === 'completed' ? 'done' : key === 'unhandled' ? 'attention' : key === 'reviewed' ? 'reviewed' : 'progress', label: info.label, icon: info.icon }; };
      const workRank = row => ({ attention: 0, progress: 1, done: 2 }[workState(row).key] ?? 1);
      const statusOptions = list => [...new Set(list.map(row => statusText(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
      const load = async () => { host.innerHTML = M.ui.loading('กำลังโหลดข้อมูลออเดอร์…'); const result = await Promise.all([request('delivery_orders?select=id,customer_id,customer_name,store_id,store_name,rider_id,rider_name,ride_selected_rider_id,status,total,payable,delivery_fee,credit_used,payment_method,dispatch_status,assigned_at,estimated_arrival_at,eta_source,dispatch_note,dispatch_updated_at,ordered_at,updated_at&order=ordered_at.desc&limit=500'), request('mobile_notifications?select=id,status,created_at&status=in.(pending,failed)&order=created_at.desc&limit=100').catch(() => [])]); rows = result[0] || []; notificationCount = (result[1] || []).length; render(); };
      const dispatchLabel = row => ({ unassigned: 'ยังไม่มอบหมาย', assigned: 'มอบหมายแล้ว', en_route: 'กำลังไปจุดรับ', arrived_pickup: 'ถึงจุดรับแล้ว', picked_up: 'รับสินค้าแล้ว', delivering: 'กำลังไปส่ง', delivered: 'ส่งสำเร็จ', exception: 'มีเหตุขัดข้อง' }[row.dispatch_status] || (row.rider_id ? 'มอบหมายแล้ว' : 'ยังไม่มอบหมาย'));
      const openOrderDetail = async row => {
        const detail = modal(`รายละเอียดออเดอร์ · ${row.id}`, `<div class="admin-order-detail-summary"><span class="mpa-badge">${esc(statusText(row))}</span><span class="admin-order-work-state admin-order-work-${esc(workState(row).key)}"><b aria-hidden="true">${esc(workState(row).icon)}</b>${esc(workState(row).label)}</span><p class="mpa-muted">สั่งเมื่อ ${row.ordered_at ? esc(new Date(row.ordered_at).toLocaleString('th-TH')) : '-'}</p></div><dl class="admin-order-detail-grid"><div><dt>เลขออเดอร์</dt><dd>${esc(row.id)}</dd></div><div><dt>ลูกค้า</dt><dd>${esc(row.customer_name || '-')}</dd></div><div><dt>ร้านค้า</dt><dd>${esc(row.store_name || '-')}</dd></div><div><dt>ผู้รับงาน</dt><dd>${row.rider_name ? `🛵 ${esc(row.rider_name)}` : 'ยังไม่มีผู้รับงาน'}</dd></div><div><dt>การจัดส่ง</dt><dd>${esc(dispatchLabel(row))}</dd></div><div><dt>ที่อยู่จัดส่ง</dt><dd>${esc(row.delivery_address || '-')}</dd></div><div><dt>วิธีชำระเงิน</dt><dd>${esc(row.payment_method || 'ไม่ระบุ')}</dd></div><div><dt>สถานะการชำระเงิน</dt><dd>${esc(row.payment_status || (row.payment_confirmed_at ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'))}</dd></div><div><dt>ยอดสินค้า</dt><dd>${money(row.total)}</dd></div><div><dt>ค่าจัดส่ง</dt><dd>${money(row.delivery_fee)}</dd></div><div><dt>เครดิตที่ใช้</dt><dd>${money(row.credit_used)}</dd></div><div><dt>ยอดชำระ</dt><dd><strong>${money(row.payable ?? row.total)}</strong></dd></div><div><dt>เวลาถึงโดยประมาณ</dt><dd>${row.estimated_arrival_at ? esc(new Date(row.estimated_arrival_at).toLocaleString('th-TH')) : 'ยังไม่กำหนด'}</dd></div><div><dt>อัปเดตล่าสุด</dt><dd>${row.updated_at ? esc(new Date(row.updated_at).toLocaleString('th-TH')) : '-'}</dd></div></dl><section class="admin-order-detail-items"><h3>รายการสินค้า</h3><div data-order-items>${M.ui.loading('กำลังอ่านรายการสินค้า…')}</div></section><section class="admin-order-detail-notes"><h3>หมายเหตุและการปฏิบัติงาน</h3><p>${esc(row.delivery_note || row.dispatch_note || row.notes || 'ไม่มีหมายเหตุ')}</p></section><div class="admin-order-detail-actions"><button class="mpa-button" data-detail-status>เปลี่ยนสถานะ</button><button class="mpa-button mpa-button-secondary" data-detail-core>แก้ข้อมูลหลัก</button><button class="mpa-button mpa-button-secondary" data-detail-edit>แก้รายการสินค้า</button><button class="mpa-button mpa-button-secondary" data-detail-assign>เปลี่ยนผู้รับงาน</button><button class="mpa-button mpa-button-secondary" data-detail-dispatch>แก้การจัดส่งและเวลาถึง</button><button class="mpa-button mpa-button-secondary" data-detail-history>ดูประวัติออเดอร์</button></div>`, `รายละเอียดออเดอร์ ${row.id}`);
        const itemsHost = detail.backdrop.querySelector('[data-order-items]');
        try {
          const items = await request(`delivery_order_items?select=id,name,emoji,unit_price,quantity,options&order_id=eq.${encodeURIComponent(row.id)}&order=id.asc&limit=100`);
          if (itemsHost) itemsHost.innerHTML = items?.length ? `<div class="admin-order-items-list">${items.map(item => `<div class="admin-order-item"><span>${esc(item.emoji || '•')}</span><div><strong>${esc(item.name || 'สินค้าไม่ระบุชื่อ')}</strong><small>${esc(item.options || '')}</small></div><b>${esc(String(item.quantity || 0))} × ${money(item.unit_price)}</b></div>`).join('')}</div>` : '<p class="mpa-muted">ไม่พบรายการสินค้า</p>';
        } catch (error) { if (itemsHost) itemsHost.innerHTML = `<p class="mpa-muted">อ่านรายการสินค้าไม่สำเร็จ: ${esc(error.message || 'ไม่ทราบสาเหตุ')}</p>`; }
        const run = fn => { detail.close(); fn(row, load); };
        detail.backdrop.querySelector('[data-detail-core]').onclick = () => run(adminOrderCoreEditor);
        detail.backdrop.querySelector('[data-detail-status]').onclick = () => run(orderStatusEditor);
        detail.backdrop.querySelector('[data-detail-edit]').onclick = () => run(orderItemEditor);
        detail.backdrop.querySelector('[data-detail-assign]').onclick = () => run(riderAssignment);
        detail.backdrop.querySelector('[data-detail-dispatch]').onclick = () => run(dispatchEditor);
        detail.backdrop.querySelector('[data-detail-history]').onclick = () => { detail.close(); orderHistory(row); };
      };
      const renderCard = row => { const work = workState(row); return `<article class="admin-order-row admin-order-row-${work.key}"><div class="admin-order-row-main"><span class="admin-order-row-id">${esc(row.id)}</span><strong>${esc(row.store_name || '-')}</strong><span>${esc(row.customer_name || '-')}</span><time>${row.ordered_at ? esc(new Date(row.ordered_at).toLocaleString('th-TH')) : '-'}</time></div><div class="admin-order-row-meta"><span class="admin-order-work-state admin-order-work-${work.key}" title="${esc(work.label)}"><b aria-hidden="true">${work.icon}</b>${esc(work.label)}</span><span class="mpa-badge">${esc(statusText(row))}</span><strong>${money(row.payable ?? row.total)}</strong><button class="mpa-button mpa-button-secondary" type="button" data-detail-order="${esc(row.id)}">ดูรายละเอียด</button></div></article>`; };
      const bindCards = filtered => filtered.forEach(row => document.querySelector(`[data-detail-order="${CSS.escape(row.id)}"]`)?.addEventListener('click', () => openOrderDetail(row)));
      const render = () => {
        const counts = (rows || []).reduce((result, row) => { const bucket = workflowBucket(row); result[bucket] += 1; return result; }, { unhandled: 0, reviewed: 0, active: 0, completed: 0 });
        Object.entries(counts).forEach(([bucket, count]) => { const countNode = document.querySelector(`[data-order-count="${bucket}"]`); if (countNode) countNode.textContent = String(count); });
        const noticeNode = document.querySelector('[data-order-notification-count]'); if (noticeNode) noticeNode.textContent = String(notificationCount);
        const inTab = (rows || []).filter(row => workflowBucket(row) === tab);
        const filters = document.querySelector('#orderStatusFilters'); const options = statusOptions(inTab); if (!options.includes(statusFilter)) statusFilter = 'all';
        if (filters) filters.innerHTML = `<button type="button" class="mpa-button ${statusFilter === 'all' ? '' : 'mpa-button-secondary'}" data-status-filter="all">ทุกสถานะ</button>${options.map(status => `<button type="button" class="mpa-button ${statusFilter === status ? '' : 'mpa-button-secondary'}" data-status-filter="${esc(status)}">${esc(status)}</button>`).join('')}`;
        const filtered = inTab.filter(row => (statusFilter === 'all' || statusText(row) === statusFilter) && (!search || [row.id, row.customer_name, row.store_name, row.rider_name].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())))).sort((a, b) => workRank(a) - workRank(b) || new Date(b.ordered_at || 0) - new Date(a.ordered_at || 0));
        const emptyMessages = { unhandled: 'ยังไม่มีออเดอร์ใหม่ที่ยังไม่ได้จัดการ', reviewed: 'ยังไม่มีออเดอร์ใหม่ที่ตรวจสอบแล้ว', active: 'ไม่มีออเดอร์ที่กำลังดำเนินการ', completed: 'ยังไม่มีออเดอร์ที่เสร็จสิ้นหรือปิดงานแล้ว' };
        const grouped = [...new Set(filtered.map(row => statusText(row)))].map(status => ({ status, rows: filtered.filter(row => statusText(row) === status) }));
        host.innerHTML = filtered.length ? grouped.map(group => `<section class="admin-order-status-group"><header><div><h2>${esc(group.status)}</h2><p>ออเดอร์ในกลุ่มนี้ ${group.rows.length} รายการ</p></div><span class="mpa-badge">${group.rows.length}</span></header><div class="admin-order-grid">${group.rows.map(renderCard).join('')}</div></section>`).join('') : `<div class="mpa-state"><p>${emptyMessages[tab]}${search ? ' ตามคำค้นหานี้' : ''}</p></div>`;
        filters?.querySelectorAll('[data-status-filter]').forEach(button => button.addEventListener('click', () => { statusFilter = button.dataset.statusFilter || 'all'; render(); }));
        bindCards(filtered);
      };
      document.querySelectorAll('[data-order-tab]').forEach(button => button.addEventListener('click', () => { tab = button.dataset.orderTab; statusFilter = 'all'; document.querySelectorAll('[data-order-tab]').forEach(item => { item.classList.toggle('mpa-button-secondary', item !== button); item.setAttribute('aria-selected', String(item === button)); }); render(); }));
      document.querySelector('#showHistory').addEventListener('click', () => { tab = 'history'; document.querySelector('[data-order-tab="history"]')?.click(); });
      document.querySelector('#refreshOrders').addEventListener('click', () => load().catch(error => notice(error.message, 'error')));
      document.querySelector('#orderSearch').addEventListener('input', event => { search = event.target.value.trim(); render(); });
      try { await load(); } catch (error) { host.innerHTML = M.ui.error('โหลดออเดอร์ไม่สำเร็จ', error.message); }
    }).catch(error => notice(error.message, 'error'));
  }


  function brandFields(value) {
    const source = value && typeof value === 'object' ? value : {};
    const logo = source.logo_url || source.logo || source.logoUrl || '';
    const background = source.background_url || source.background || source.backgroundUrl || '';
    const banners = Array.isArray(source.banners) ? source.banners : (Array.isArray(source.banner_urls) ? source.banner_urls : []);
    return { source, logo, background, banners };
  }

  function mediaCenterPatch() {
    const R = runtime();
    if (!R) return;
    const content = `<div class="mpa-page-head"><div><h1>ศูนย์จัดการสื่อโฆษณา</h1><p>ดูและแก้ไขสื่อที่ใช้บนหน้า Customer แยกเป็น Logo, Background, Banner และคลังสื่อ โดยรายการเดิมแก้ไขได้ทีละรายการ</p></div><button class="mpa-button mpa-button-secondary" id="refreshMedia">รีเฟรช</button></div><section class="mpa-card" id="brandCenter"><h2 style="margin-top:0">แบรนด์หน้า Customer</h2>${M.ui.loading('กำลังโหลด Logo และ Background…')}</section><section class="mpa-card" style="margin-top:16px" id="bannerCenter"><h2 style="margin-top:0">Banner หน้า Customer</h2>${M.ui.loading('กำลังโหลด Banner…')}</section><section class="mpa-card" style="margin-top:16px" id="assetCenter"><h2 style="margin-top:0">คลังสื่อทั้งหมด</h2>${M.ui.loading('กำลังโหลด media assets…')}</section>`;
    R.gate('media', content).then(async access => {
      if (!access) return;
      R.user = access.user;
      const uploadMedia = async (file, options = {}) => {
        const session = M.auth.getSession?.();
        if (!session?.access_token || !access.user?.id) throw new Error('เซสชันแอดมินหมดอายุ กรุณาเข้าสู่ระบบใหม่ก่อนอัปโหลด');
        if (!window.APServiceMedia?.uploadPublicImage) throw new Error('ระบบอัปโหลดรูปภาพยังโหลดไม่พร้อม กรุณารีเฟรชหน้าเว็บแล้วลองใหม่');
        return window.APServiceMedia.uploadPublicImage(file, { ...M.config, accessToken: session.access_token, actorId: access.user.id, bucket: 'catalog-media', pathPrefix: 'admin', ownerType: 'admin', ...options });
      };
      const brandHost = document.querySelector('#brandCenter'); const bannerHost = document.querySelector('#bannerCenter'); const assetHost = document.querySelector('#assetCenter');
      const load = async () => {
        const [brandRows, promotionRows, assets] = await Promise.all([
          request('platform_configs?select=key,value,updated_at&key=eq.brand_public&limit=1').catch(() => []),
          request('platform_configs?select=key,value,updated_at&key=eq.customer_promotions&limit=1').catch(() => []),
          request('media_assets?select=id,owner_id,owner_type,media_type,bucket_id,storage_path,visibility,variant,mime_type,byte_size,width,height,version,status,legacy_source,created_at,updated_at&order=created_at.desc&limit=250').catch(() => [])
        ]);
        const brandRow = brandRows?.[0] || { key: 'brand_public', value: {} }; const fields = brandFields(brandRow.value);
        brandHost.innerHTML = `<h2 style="margin-top:0">แบรนด์หน้า Customer</h2><form id="brandForm"><div class="admin-form-grid"><label class="mpa-field"><span>Logo</span><div style="display:flex;gap:8px;flex-wrap:wrap"><label class="mpa-button mpa-button-secondary">เลือกจากคลังภาพ<input hidden type="file" accept="image/jpeg,image/png,image/webp" data-brand-media="logo_url"></label><label class="mpa-button mpa-button-secondary">ถ่ายรูป<input hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-brand-media="logo_url"></label></div><input name="logo_url" value="${esc(fields.logo)}" placeholder="URL เดิม (ถ้ามี)"><small class="mpa-muted" data-brand-media-status="logo_url">รูปจะถูกบีบอัด ตรวจ URL และลงทะเบียนก่อนบันทึก</small></label><label class="mpa-field"><span>Background</span><div style="display:flex;gap:8px;flex-wrap:wrap"><label class="mpa-button mpa-button-secondary">เลือกจากคลังภาพ<input hidden type="file" accept="image/jpeg,image/png,image/webp" data-brand-media="background_url"></label><label class="mpa-button mpa-button-secondary">ถ่ายรูป<input hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-brand-media="background_url"></label></div><input name="background_url" value="${esc(fields.background)}" placeholder="URL เดิม (ถ้ามี)"><small class="mpa-muted" data-brand-media-status="background_url">รูปจะถูกบีบอัด ตรวจ URL และลงทะเบียนก่อนบันทึก</small></label><label class="mpa-field admin-form-full"><span>Banner รูปภาพ (หนึ่ง URL ต่อบรรทัด)</span><div style="display:flex;gap:8px;flex-wrap:wrap"><label class="mpa-button mpa-button-secondary">เลือกจากคลังภาพ<input hidden type="file" accept="image/jpeg,image/png,image/webp" multiple data-brand-media="banner_urls"></label><label class="mpa-button mpa-button-secondary">ถ่ายรูป<input hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-brand-media="banner_urls"></label></div><textarea name="banner_urls" rows="3" placeholder="ระบบจะใส่ URL หลังอัปโหลดและตรวจสอบแล้ว">${esc(fields.banners.join('\n'))}</textarea><small class="mpa-muted" data-brand-media-status="banner_urls">อัปโหลดได้หลายรูป ระบบจะบีบอัดและเพิ่ม URL ที่ตรวจสอบแล้วลงในรายการ</small></label></div><div class="admin-media-pair"><div>${fields.logo ? `<img src="${esc(fields.logo)}" alt="Logo ปัจจุบัน">` : '<p class="mpa-muted">ยังไม่มี Logo</p>'}</div><div>${fields.background ? `<img src="${esc(fields.background)}" alt="Background ปัจจุบัน">` : '<p class="mpa-muted">ยังไม่มี Background</p>'}</div></div><button class="mpa-button" type="submit">บันทึกแบรนด์และ Banner</button></form>`;
        const brandForm = brandHost.querySelector('#brandForm');
        brandForm.querySelectorAll('[data-brand-media]').forEach(input => input.onchange = async event => {
          const target = event.target.dataset.brandMedia;
          const files = Array.from(event.target.files || []).filter(Boolean);
          if (!target || !files.length) return;
          const field = brandForm.elements[target];
          const status = brandForm.querySelector(`[data-brand-media-status="${target}"]`);
          try {
            if (status) status.textContent = `กำลังบีบอัดและอัปโหลด ${files.length} รูป…`;
            const urls = [];
            for (const file of files) {
              const uploaded = await uploadMedia(file, { mediaType: target === 'logo_url' ? 'BRAND_LOGO' : target === 'background_url' ? 'BRAND_BACKGROUND' : 'CUSTOMER_BANNER', scope: `customer-${target.replace('_url', '')}`, variant: target.replace('_url', ''), legacySource: { source: 'admin-media-center', field: target } });
              if (uploaded?.publicUrl) urls.push(uploaded.publicUrl);
            }
            if (field && urls.length) { if (target !== 'banner_urls' && field.value.trim() && field.value.trim() !== urls[0]) field.dataset.previousMediaUrl = field.value.trim(); field.value = target === 'banner_urls' ? [field.value.trim(), ...urls].filter(Boolean).join('\n') : urls[0]; }
            if (status) status.textContent = `อัปโหลดและตรวจสอบแล้ว ${urls.length} รูป · กดบันทึกเพื่อยืนยัน`;
            notice(`อัปโหลด ${target === 'banner_urls' ? 'Banner' : target === 'logo_url' ? 'Logo' : 'Background'} แล้ว กดบันทึกเพื่อยืนยัน`);
          } catch (error) {
            if (status) status.textContent = `อัปโหลดไม่สำเร็จ: ${error.message}`;
            notice(error.message || 'อัปโหลดรูปภาพไม่สำเร็จ', 'error');
          } finally { event.target.value = ''; }
        });
        brandForm.onsubmit = async event => {
          event.preventDefault(); const form = event.currentTarget; const nextLogo = form.elements.logo_url.value.trim(); const nextBackground = form.elements.background_url.value.trim(); const nextBanners = form.elements.banner_urls.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean); const next = { ...fields.source, logo_url: nextLogo || null, background_url: nextBackground || null, banner_urls: nextBanners, banners: nextBanners };
          if (Object.prototype.hasOwnProperty.call(fields.source, 'logo')) next.logo = nextLogo || null; if (Object.prototype.hasOwnProperty.call(fields.source, 'background')) next.background = nextBackground || null;
          try { await request('platform_configs?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: 'brand_public', value: next, updated_at: iso() }]) }); const checked = await request('platform_configs?select=value&key=eq.brand_public&limit=1', { forceFresh: true }); if (!checked?.[0] || stableJson(checked[0].value) !== stableJson(next)) throw new Error('บันทึกแล้วแต่ตรวจสอบแบรนด์จากฐานข้อมูลไม่ตรงกัน กรุณาลองใหม่'); const session = M.auth.getSession?.(); for (const input of [form.elements.logo_url, form.elements.background_url]) { if (input?.dataset.previousMediaUrl && window.APServiceMedia?.cleanupReplacedPublicMedia) await window.APServiceMedia.cleanupReplacedPublicMedia({ ...M.config, accessToken: session?.access_token, actorId: session?.user?.id, oldUrl: input.dataset.previousMediaUrl, newUrl: input.value, bucket: 'catalog-media', pathPrefix: 'admin' }); if (input) delete input.dataset.previousMediaUrl; } await audit('brand_public_updated', null, 'แก้ไข Logo/Background/Banner จาก Media Center', fields.source, next); notice('บันทึกแบรนด์และ Banner แล้ว'); load(); } catch (error) { notice(`บันทึกแบรนด์ไม่สำเร็จ: ${error.message}`, 'error'); }
        };
        const normalizePromotions = value => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);
        const promotions = normalizePromotions(promotionRows?.[0]?.value);
        bannerHost.innerHTML = `<h2 style="margin-top:0">Banner หน้า Customer</h2>${promotions.length ? `<div class="admin-media-legacy-grid">${promotions.map((row, index) => `<article class="admin-media-legacy-card" data-promotion-card="${index}">${row.image_url ? `<img src="${esc(row.image_url)}" alt="${esc(row.title || 'Banner')}">` : '<div class="mpa-muted" style="padding:18px">ยังไม่มีภาพ</div>'}<div><h3>${esc(row.title || row.badge || `Banner ${index + 1}`)}</h3><label class="mpa-field">หัวข้อ<input data-promo-field="title" value="${esc(row.title || '')}"></label><label class="mpa-field">ป้ายกำกับ<input data-promo-field="badge" value="${esc(row.badge || '')}"></label><label class="mpa-field">รายละเอียด<textarea data-promo-field="description" rows="2">${esc(row.description || '')}</textarea></label><label class="mpa-field">รูปภาพ Banner<div style="display:flex;gap:8px;flex-wrap:wrap"><label class="mpa-button mpa-button-secondary">เลือกจากคลังภาพ<input hidden type="file" accept="image/jpeg,image/png,image/webp" data-promo-media-input="${index}"></label><label class="mpa-button mpa-button-secondary">ถ่ายรูป<input hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-promo-media-input="${index}"></label></div><input data-promo-field="image_url" type="url" value="${esc(row.image_url || '')}" required><small class="mpa-muted" data-promo-media-status="${index}">รูปจะถูกบีบอัด ตรวจ URL และลงทะเบียนก่อนบันทึก</small></label><label class="mpa-field">การแสดงผล<select data-promo-field="active"><option value="true" ${row.active !== false ? 'selected' : ''}>เปิด</option><option value="false" ${row.active === false ? 'selected' : ''}>ปิด</option></select></label><button class="mpa-button mpa-button-secondary" data-save-promo="${index}">บันทึก Banner รายการนี้</button></div></article>`).join('')}</div>` : '<p class="mpa-muted">ยังไม่มี Banner ใน customer_promotions รายการ Logo/Background อยู่ในส่วนแบรนด์ด้านบน</p>'}`;
        bannerHost.querySelectorAll('[data-promo-media-input]').forEach(input => input.onchange = async event => {
          const index = Number(event.target.dataset.promoMediaInput);
          const file = event.target.files?.[0];
          const card = bannerHost.querySelector(`[data-promotion-card="${index}"]`);
          if (!file || !card || !promotions[index]) return;
          const status = card.querySelector(`[data-promo-media-status="${index}"]`);
          try {
            if (status) status.textContent = 'กำลังบีบอัดและอัปโหลด Banner…';
            const uploaded = await uploadMedia(file, { mediaType: 'CUSTOMER_BANNER', scope: `customer-promotion-${promotions[index].id || index}`, variant: 'banner', legacySource: { source: 'admin-media-center', promotionIndex: index, promotionId: promotions[index].id || null } });
            const imageField = card.querySelector('[data-promo-field="image_url"]');
            if (imageField) { const previousUrl = imageField.value.trim(); if (previousUrl && previousUrl !== uploaded.publicUrl) imageField.dataset.previousMediaUrl = previousUrl; imageField.dataset.pendingMediaPath = uploaded.path || ''; imageField.value = uploaded.publicUrl; }
            if (status) status.textContent = 'อัปโหลดและตรวจสอบแล้ว · กดบันทึก Banner เพื่อยืนยัน';
            notice('อัปโหลดรูป Banner แล้ว กดบันทึกรายการเพื่อยืนยัน');
          } catch (error) {
            if (status) status.textContent = `อัปโหลดไม่สำเร็จ: ${error.message}`;
            notice(error.message || 'อัปโหลด Banner ไม่สำเร็จ', 'error');
          } finally { event.target.value = ''; }
        });
        bannerHost.querySelectorAll('[data-save-promo]').forEach(button => button.onclick = async () => { const index = Number(button.dataset.savePromo); const card = bannerHost.querySelector(`[data-promotion-card="${index}"]`); const row = promotions[index]; if (!row || !card) return; const imageField = card.querySelector('[data-promo-field="image_url"]'); const next = { ...row, title: card.querySelector('[data-promo-field="title"]').value.trim(), badge: card.querySelector('[data-promo-field="badge"]').value.trim(), description: card.querySelector('[data-promo-field="description"]').value.trim(), image_url: imageField.value.trim(), active: card.querySelector('[data-promo-field="active"]').value === 'true' }; try { const value = { items: promotions.map((item, itemIndex) => itemIndex === index ? next : item) }; await request('platform_configs?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: 'customer_promotions', value, updated_at: iso() }]) }); const checked = await request('platform_configs?select=value&key=eq.customer_promotions&limit=1', { forceFresh: true }); if (!checked?.[0] || stableJson(checked[0].value) !== stableJson(value)) throw new Error('บันทึกแล้วแต่ตรวจสอบ Banner จากฐานข้อมูลไม่ตรงกัน กรุณาลองใหม่'); const session = M.auth.getSession?.(); if (imageField.dataset.previousMediaUrl && window.APServiceMedia?.cleanupReplacedPublicMedia) await window.APServiceMedia.cleanupReplacedPublicMedia({ ...M.config, accessToken: session?.access_token, actorId: session?.user?.id, oldUrl: imageField.dataset.previousMediaUrl, newUrl: imageField.value, bucket: 'catalog-media', pathPrefix: 'admin' }); delete imageField.dataset.previousMediaUrl; delete imageField.dataset.pendingMediaPath; await audit('customer_promotion_updated', null, `แก้ไข Banner รายการที่ ${index + 1}`, row, next); notice('บันทึก Banner รายการนี้แล้ว'); load(); } catch (error) { notice(`บันทึก Banner ไม่สำเร็จ: ${error.message}`, 'error'); } });
        assetHost.innerHTML = `<h2 style="margin-top:0">คลังสื่อทั้งหมด</h2><p class="mpa-muted">แสดงรายการ media_assets ตาม registry จริงของระบบ โดยไม่สร้าง URL ใหม่หรือย้ายไฟล์ใน Storage</p>${assets?.length ? `<div class="mpa-table-wrap"><table class="mpa-table"><thead><tr><th>ประเภท</th><th>Bucket / Path</th><th>การเข้าถึง</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${assets.map(row => `<tr><td><b>${esc(row.media_type || '-')}</b><br><span class="mpa-muted">${esc(row.mime_type || '-')}</span></td><td>${esc(row.bucket_id || '-')}<br><span class="mpa-muted">${esc(row.storage_path || '-')}</span></td><td>${esc(row.visibility || '-')}</td><td>${esc(row.status || '-')}</td><td><button class="mpa-button mpa-button-secondary" data-edit-asset="${esc(row.id)}">แก้ไข</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="mpa-muted">ยังไม่มีรายการใน media_assets</p>'}`;
        assetHost.querySelectorAll('[data-edit-asset]').forEach(button => button.onclick = () => editAsset((assets || []).find(row => row.id === button.dataset.editAsset), load));
      };
      const editAsset = (row, afterSave) => {
        if (!row) return;
        const body = `<form id="assetForm"><div class="admin-form-grid"><label class="mpa-field"><span>ประเภทสื่อ</span><input name="media_type" value="${esc(row.media_type || '')}" required></label><label class="mpa-field"><span>Bucket</span><input name="bucket_id" value="${esc(row.bucket_id || '')}" required></label><label class="mpa-field admin-form-full"><span>Storage path</span><input name="storage_path" value="${esc(row.storage_path || '')}" required></label><label class="mpa-field"><span>Visibility</span><input name="visibility" value="${esc(row.visibility || '')}" required></label><label class="mpa-field"><span>Variant</span><input name="variant" value="${esc(row.variant || 'original')}"></label><label class="mpa-field"><span>สถานะ</span><input name="status" value="${esc(row.status || 'ready')}" required></label><label class="mpa-field admin-form-full"><span>Legacy source JSON</span><textarea name="legacy_source" rows="4">${esc(JSON.stringify(row.legacy_source || {}, null, 2))}</textarea></label></div><div class="admin-modal-actions"><button type="button" class="mpa-button mpa-button-secondary" data-close>ยกเลิก</button><button class="mpa-button" type="submit">บันทึกรายการนี้</button></div></form>`;
        const dialog = modal(`แก้ไขสื่อ: ${row.label || row.asset_type || row.id}`, body, 'แก้ไข media asset');
        dialog.backdrop.querySelector('#assetForm').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; let legacySource = {}; try { legacySource = JSON.parse(form.elements.legacy_source.value || '{}'); } catch (_) { return notice('Legacy source ต้องเป็น JSON ที่ถูกต้อง', 'error'); } try { const next = { media_type: form.elements.media_type.value.trim(), bucket_id: form.elements.bucket_id.value.trim(), storage_path: form.elements.storage_path.value.trim(), visibility: form.elements.visibility.value.trim(), variant: form.elements.variant.value.trim() || 'original', status: form.elements.status.value.trim(), legacy_source: legacySource, updated_at: iso() }; await request(`media_assets?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(next) }); await audit('media_asset_updated', null, `แก้ไข media asset ${row.id}`, row, next); notice('แก้ไข media asset รายการนี้แล้ว'); dialog.close(); afterSave(); } catch (error) { notice(`แก้ไขสื่อไม่สำเร็จ: ${error.message}`, 'error'); } };
      };
      document.querySelector('#refreshMedia').onclick = () => load().catch(error => notice(error.message, 'error'));
      try { await load(); } catch (error) { brandHost.innerHTML = M.ui.error('โหลดแบรนด์ไม่สำเร็จ', error.message); bannerHost.innerHTML = M.ui.error('โหลด Banner ไม่สำเร็จ', error.message); assetHost.innerHTML = M.ui.error('โหลดคลังสื่อไม่สำเร็จ', error.message); }
    }).catch(error => notice(error.message, 'error'));
  }

  async function accountsPatch() {
    const R = runtime();
    if (!R) return;
    const content = `<div class="mpa-page-head"><div><h1>จัดการบัญชีทุกบทบาท</h1><p>ลูกค้า ไรเดอร์ เจ้าของร้าน และผู้ดูแลระบบอยู่ในศูนย์เดียวกัน พร้อมค้นหา กรอง และระงับบัญชีโดยบันทึกประวัติการดำเนินการ</p></div><button class="mpa-button mpa-button-secondary" id="refreshAccounts">รีเฟรช</button></div><section class="mpa-card" id="accountsCenter">${M.ui.loading('กำลังโหลดบัญชี…')}</section>`;
    R.gate('accounts', content).then(async access => {
      if (!access) return;
      R.user = access.user;
      const host = document.querySelector('#accountsCenter');
      let rows = [];
      let search = '';
      let roleFilter = 'all';
      const roleLabel = role => ({ customer: 'ลูกค้า', rider: 'ไรเดอร์', store_owner: 'เจ้าของร้าน', admin: 'ผู้ดูแลระบบ' }[String(role || '').toLowerCase()] || String(role || 'ไม่ระบุ'));
      const render = () => {
        const filtered = rows.filter(row => {
          const haystack = [row.id, row.display_name, row.email, row.phone, ...(row.roles || [])].join(' ').toLowerCase();
          return (!search || haystack.includes(search.toLowerCase())) && (roleFilter === 'all' || (row.roles || []).includes(roleFilter));
        });
        host.innerHTML = `<div class="admin-form-grid"><label class="mpa-field"><span>ค้นหาบัญชี</span><input id="accountSearch" type="search" value="${esc(search)}" placeholder="ชื่อ อีเมล เบอร์โทร หรือรหัสผู้ใช้"></label><label class="mpa-field"><span>กรองตามบทบาท</span><select id="accountRole"><option value="all" ${roleFilter === 'all' ? 'selected' : ''}>ทุกบทบาท</option><option value="customer" ${roleFilter === 'customer' ? 'selected' : ''}>ลูกค้า</option><option value="rider" ${roleFilter === 'rider' ? 'selected' : ''}>ไรเดอร์</option><option value="store_owner" ${roleFilter === 'store_owner' ? 'selected' : ''}>เจ้าของร้าน</option><option value="admin" ${roleFilter === 'admin' ? 'selected' : ''}>ผู้ดูแลระบบ</option></select></label></div><p class="mpa-muted">พบ ${filtered.length} จาก ${rows.length} บัญชี · การแก้ไขสถานะจะบันทึกใน account_controls และ admin_action_audit</p>${filtered.length ? `<div class="mpa-table-wrap"><table class="mpa-table"><thead><tr><th>บัญชี</th><th>บทบาท</th><th>โทรศัพท์</th><th>สถานะ</th><th>สร้างเมื่อ</th><th>จัดการ</th></tr></thead><tbody>${filtered.map(row => `<tr><td><b>${esc(row.display_name || '-')}</b><br><span class="mpa-muted">${esc(row.email || row.id)}</span></td><td>${(row.roles || []).map(role => `<span class="mpa-badge">${esc(roleLabel(role))}</span>`).join(' ') || '-'}</td><td>${esc(row.phone || '-')}</td><td>${row.suspended ? '<span class="mpa-badge" style="background:#fff0f0;color:#a22">ระงับ</span>' : '<span class="mpa-badge">ใช้งาน</span>'}${row.suspension_reason ? `<br><small>${esc(row.suspension_reason)}</small>` : ''}</td><td>${row.created_at ? new Date(row.created_at).toLocaleDateString('th-TH') : '-'}</td><td><button class="mpa-button mpa-button-secondary" data-account-edit="${esc(row.id)}">ดู/จัดการ</button></td></tr>`).join('')}</tbody></table></div>` : M.ui.empty('ไม่พบบัญชีตามตัวกรอง')}`;
        host.querySelector('#accountSearch').oninput = event => { search = event.target.value.trim(); render(); };
        host.querySelector('#accountRole').onchange = event => { roleFilter = event.target.value; render(); };
        host.querySelectorAll('[data-account-edit]').forEach(button => button.onclick = () => {
          const row = rows.find(item => item.id === button.dataset.accountEdit);
          if (!row) return;
          const body = `<form id="accountForm"><p class="mpa-muted">รหัสผู้ใช้: ${esc(row.id)}</p><p><b>บทบาท:</b> ${(row.roles || []).map(roleLabel).map(esc).join(', ') || 'ไม่ระบุ'}</p><label class="mpa-field"><span>ชื่อที่แสดง</span><input name="display_name" value="${esc(row.display_name || '')}" disabled></label><label class="mpa-field"><span>อีเมล</span><input value="${esc(row.email || '')}" disabled></label><label class="mpa-field"><span>สถานะบัญชี</span><select name="suspended"><option value="false" ${!row.suspended ? 'selected' : ''}>เปิดใช้งาน</option><option value="true" ${row.suspended ? 'selected' : ''}>ระงับบัญชี</option></select></label><label class="mpa-field"><span>เหตุผลการระงับ</span><textarea name="suspension_reason" rows="3" maxlength="500">${esc(row.suspension_reason || '')}</textarea></label><div class="admin-modal-actions"><button type="button" class="mpa-button mpa-button-secondary" data-close>ยกเลิก</button><button class="mpa-button" type="submit">บันทึกสถานะบัญชี</button></div></form>`;
          const dialog = modal(`จัดการบัญชี: ${row.display_name || row.email || row.id}`, body, 'จัดการบัญชี');
          dialog.backdrop.querySelector('#accountForm').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; const suspended = form.elements.suspended.value === 'true'; const reason = form.elements.suspension_reason.value.trim(); if (suspended && !reason) return notice('กรุณาระบุเหตุผลก่อนระงับบัญชี', 'error'); if (row.id === access.user.id && suspended) return notice('ไม่อนุญาตให้ระงับบัญชี Admin ที่กำลังใช้งานอยู่', 'error'); const next = { user_id: row.id, suspended, suspension_reason: suspended ? reason : null, updated_at: iso() }; try { await request('account_controls?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(next) }); await audit(suspended ? 'account_suspended' : 'account_reactivated', row.id, reason || (suspended ? 'ระงับบัญชี' : 'เปิดใช้งานบัญชี'), { suspended: row.suspended, suspension_reason: row.suspension_reason }, next); notice(suspended ? 'ระงับบัญชีแล้ว' : 'เปิดใช้งานบัญชีแล้ว'); dialog.close(); await load(); } catch (error) { notice(`บันทึกบัญชีไม่สำเร็จ: ${error.message}`, 'error'); } };
        });
      };
      const load = async () => { const [profiles, roles, controls] = await Promise.all([request('user_profiles?select=id,display_name,email,phone,created_at&order=created_at.desc&limit=1000').catch(() => []), request('user_roles?select=user_id,role,created_at&order=created_at.desc&limit=2000').catch(() => []), request('account_controls?select=user_id,suspended,suspension_reason,updated_at&limit=2000').catch(() => [])]); const byId = new Map(); (profiles || []).forEach(profile => byId.set(profile.id, { id: profile.id, display_name: profile.display_name, email: profile.email, phone: profile.phone, created_at: profile.created_at, roles: [], suspended: false, suspension_reason: '' })); (roles || []).forEach(role => { const row = byId.get(role.user_id) || { id: role.user_id, display_name: '', email: '', phone: '', created_at: role.created_at, roles: [], suspended: false, suspension_reason: '' }; if (!byId.has(role.user_id)) byId.set(role.user_id, row); if (role.role && !row.roles.includes(role.role)) row.roles.push(role.role); }); (controls || []).forEach(control => { const row = byId.get(control.user_id) || { id: control.user_id, display_name: '', email: '', phone: '', created_at: control.updated_at, roles: [], suspended: false, suspension_reason: '' }; if (!byId.has(control.user_id)) byId.set(control.user_id, row); row.suspended = control.suspended === true; row.suspension_reason = control.suspension_reason || ''; }); rows = Array.from(byId.values()); render(); };
      document.querySelector('#refreshAccounts').onclick = () => load().catch(error => notice(error.message, 'error'));
      try { await load(); } catch (error) { host.innerHTML = M.ui.error('โหลดบัญชีไม่สำเร็จ', error.message); }
    }).catch(error => notice(error.message, 'error'));
  }

  function enhanceOrderCancellationButtons() {
    if (document.body.dataset.page !== 'orders') return;
    document.querySelectorAll('.admin-order-card').forEach(card => {
      if (card.dataset.cancellationControlReady) return;
      const orderId = card.querySelector('h2')?.textContent?.trim(); const actions = card.querySelector('.admin-order-actions');
      if (!orderId || !actions) return;
      card.dataset.cancellationControlReady = 'true';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mpa-button mpa-button-secondary'; button.textContent = 'พิจารณายกเลิก'; button.dataset.cancelOrder = orderId;
      button.onclick = async () => {
        try {
          const rows = await request(`delivery_orders?select=id,customer_name,store_name,status,total,payable& id=eq.${encodeURIComponent(orderId)}&limit=1`.replace('& ', '&'));
          if (!rows?.[0]) throw new Error('ไม่พบออร์เดอร์ที่ต้องการตรวจ');
          cancellationReview(rows[0], () => location.reload()).catch(error => notice(error.message || 'เปิดคำขอยกเลิกไม่สำเร็จ', 'error'));
        } catch (error) { notice(error.message || 'โหลดออร์เดอร์ไม่สำเร็จ', 'error'); }
      };
      actions.append(button);
    });
  }
  if (document.body.dataset.page === 'orders') {
    const cancellationObserver = new MutationObserver(() => requestAnimationFrame(enhanceOrderCancellationButtons));
    cancellationObserver.observe(document.body, { childList: true, subtree: true });
    enhanceOrderCancellationButtons();
    addEventListener('pagehide', () => cancellationObserver.disconnect(), { once: true });
  }

  window.APServiceAdminPatch = { dashboard: dashboardPatch, orders: ordersPatch, media: mediaCenterPatch };
})();

/* The patch is intentionally loaded before admin-app.js. The base app exposes its
 * existing auth gate and shell immediately before dispatching each route. */
