(() => {
  'use strict';
  const M = window.APServiceMPA;
  if (!M || document.body.dataset.page !== 'riders') return;

  const esc = value => M.ui.escapeHtml(String(value ?? ''));
  const notice = (message, type) => M.ui.setNotice(message, type);
  const invoke = async payload => {
    const session = await M.auth.refreshSession(false);
    if (!session?.access_token) throw new Error('เซสชันแอดมินหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const response = await fetch(`${M.config.url}/functions/v1/role-access`, {
      method: 'POST',
      headers: { apikey: M.config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'ไม่สามารถบันทึกผลการตรวจเอกสารได้');
    return result;
  };
  const modal = (title, body) => {
    const node = document.createElement('div');
    node.className = 'mpa-modal-backdrop';
    node.innerHTML = `<section class="mpa-card mpa-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mpa-page-head"><h2 style="margin:0">${esc(title)}</h2><button class="mpa-button mpa-button-secondary" type="button" data-close>ปิด</button></div>${body}</section>`;
    document.body.append(node);
    const close = () => node.remove();
    node.querySelectorAll('[data-close]').forEach(button => { button.onclick = close; });
    return { node, close };
  };
  const documentState = (value, label, path = '') => `<div><dt>${esc(label)}</dt><dd>${value ? 'พร้อมตรวจ' : 'ยังไม่มี'}${path ? ` <button type="button" class="mpa-button mpa-button-secondary" data-open-rider-document="${esc(path)}" style="margin-top:6px">เปิดเอกสารส่วนตัว</button>` : ''}</dd></div>`;
  const formatSubmittedAt = value => { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('th-TH'); };

  async function openPrivateDocument(path, label) {
    if (!window.APServiceMedia?.createSignedImageUrl) throw new Error('ระบบเปิดเอกสารส่วนตัวยังโหลดไม่พร้อม กรุณารีเฟรชหน้าเว็บแล้วลองใหม่');
    const session = await M.auth.refreshSession(false);
    if (!session?.access_token) throw new Error('เซสชันแอดมินหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const dialog = modal(`หลักฐานไรเดอร์ · ${label}`, '<p class="mpa-muted">กำลังสร้าง URL สำหรับดูเอกสารแบบชั่วคราว…</p><div data-private-document-host></div>');
    try {
      const signedUrl = await window.APServiceMedia.createSignedImageUrl({ url: M.config.url, publishableKey: M.config.publishableKey, accessToken: session.access_token, bucket: 'rider-documents', path, expiresIn: 300 });
      const host = dialog.node.querySelector('[data-private-document-host]');
      host.innerHTML = `<img src="${esc(signedUrl)}" alt="${esc(label)}" style="display:block;width:100%;max-height:70vh;object-fit:contain;border:1px solid var(--ap-line);border-radius:12px;background:#f8faf9" referrerpolicy="no-referrer"><p class="mpa-muted" style="margin-bottom:0">ลิงก์นี้เป็น private signed URL และหมดอายุอัตโนมัติ</p>`;
    } catch (error) {
      dialog.close();
      throw error;
    }
  }

  async function review(riderId) {
    const rows = await M.request(`riders?select=id,name,phone,compliance_status,compliance_note,identity_verified,identity_document_image_url,license_number,license_expiry,license_image_url,vehicle_registration_image_url,insurance_expiry,insurance_image_url&id=eq.${encodeURIComponent(riderId)}&limit=1`, { private: true, forceFresh: true });
    const rider = rows?.[0];
    if (!rider) throw new Error('ไม่พบไรเดอร์');
    const submissions = await M.request(`rider_document_submissions?select=id,document_refs,status,note,submitted_at,reviewed_at,review_note&rider_id=eq.${encodeURIComponent(riderId)}&order=submitted_at.desc&limit=5`, { private: true, forceFresh: true });
    const pending = (submissions || []).find(row => row.status === 'pending') || null;
    const refs = pending?.document_refs && typeof pending.document_refs === 'object' ? pending.document_refs : {};
    const identityPath = refs.identity_document_image_url || rider.identity_document_image_url || '';
    const licensePath = refs.license_image_url || rider.license_image_url || '';
    const vehiclePath = refs.vehicle_registration_image_url || rider.vehicle_registration_image_url || '';
    const insurancePath = refs.insurance_image_url || rider.insurance_image_url || '';
    const submissionPanel = pending ? `<section style="margin:16px 0;padding:14px;border:1px solid var(--ap-line);border-radius:12px;background:#f8faf9"><p class="mpa-kicker">เอกสารที่ไรเดอร์ส่งเข้ามา</p><h3 style="margin:0 0 6px">มีเอกสารรอตรวจจากไรเดอร์</h3><p class="mpa-muted" style="margin:0">ส่งเมื่อ ${esc(formatSubmittedAt(pending.submitted_at))} · สถานะ ${esc(pending.status)}</p><p class="mpa-muted" style="margin:8px 0 0">ระบบแยกไฟล์ที่ Rider ส่งออกจาก protected compliance fields; การอนุมัติยังต้องตรวจ metadata โดย Admin ให้ครบก่อน</p></section>` : `<p class="mpa-muted">ยังไม่มี submission ที่รอตรวจ ระบบจะแสดงข้อมูลเอกสารเดิมจาก Rider record</p>`;
    const metadataPanel = `<section style="margin:16px 0;padding:14px;border:1px solid var(--ap-line);border-radius:12px"><p class="mpa-kicker">ข้อมูลสำคัญที่ผู้ดูแลบันทึก</p><h3 style="margin:0 0 6px">ข้อมูลที่ Admin ตรวจและบันทึก</h3><p class="mpa-muted" style="margin:0 0 12px">ข้อมูลเหล่านี้เป็นข้อมูลสำคัญ ผู้ดูแลต้องยืนยันจากเอกสารจริงก่อนเลือกอนุมัติให้รับงาน</p><label class="mpa-field" style="display:flex;gap:8px;align-items:center"><input id="identityVerified" type="checkbox" ${rider.identity_verified ? 'checked' : ''}> ยืนยันตัวตนแล้ว</label><div class="mpa-grid"><label class="mpa-field">เลขใบขับขี่<input id="licenseNumber" value="${esc(rider.license_number || '')}" maxlength="120"></label><label class="mpa-field">ใบขับขี่หมดอายุ<input id="licenseExpiry" type="date" value="${esc(rider.license_expiry || '')}"></label><label class="mpa-field">ประกันหมดอายุ<input id="insuranceExpiry" type="date" value="${esc(rider.insurance_expiry || '')}"></label></div></section>`;
    const body = `${submissionPanel}${metadataPanel}<dl class="admin-withdrawal-review-grid"><div><dt>ไรเดอร์</dt><dd>${esc(rider.name || rider.id)}</dd></div><div><dt>ผลตรวจเดิม</dt><dd>${esc(rider.compliance_status || 'pending')}</dd></div>${documentState(Boolean(rider.identity_verified), 'ยืนยันตัวตนโดย Admin')}${documentState(Boolean(identityPath), 'เอกสารยืนยันตัวตน', identityPath)}${documentState(Boolean(rider.license_number && licensePath), 'ใบขับขี่', licensePath)}${documentState(Boolean(vehiclePath), 'ทะเบียนรถ', vehiclePath)}${documentState(Boolean(insurancePath), 'ประกันรถ', insurancePath)}<div><dt>เลขใบขับขี่</dt><dd>${esc(rider.license_number || '-')}</dd></div><div><dt>ใบขับขี่หมดอายุ</dt><dd>${esc(rider.license_expiry || '-')}</dd></div><div><dt>ประกันหมดอายุ</dt><dd>${esc(rider.insurance_expiry || '-')}</dd></div></dl><label class="mpa-field"><span>ผลพิจารณา</span><select id="complianceDecision"><option value="approved">อนุมัติให้รับงาน</option><option value="rejected">ไม่อนุมัติและให้แก้ไขเอกสาร</option></select></label><label class="mpa-field"><span>เหตุผลการพิจารณา</span><textarea id="complianceNote" rows="3" required placeholder="ไรเดอร์จะเห็นข้อความนี้ในหน้าโปรไฟล์"></textarea></label><div class="admin-modal-actions"><button class="mpa-button mpa-button-secondary" type="button" data-close>ยกเลิก</button><button class="mpa-button" type="button" id="saveCompliance">บันทึกผล</button></div>`;
    const dialog = modal(`ตรวจเอกสาร · ${rider.name || rider.id}`, body);
    dialog.node.querySelectorAll('[data-open-rider-document]').forEach(button => {
      button.onclick = () => openPrivateDocument(button.dataset.openRiderDocument, button.closest('div')?.querySelector('dt')?.textContent || 'เอกสาร').catch(error => notice(error.message || 'เปิดเอกสารไม่สำเร็จ', 'error'));
    });
    dialog.node.querySelector('#saveCompliance').onclick = async () => {
      const decision = dialog.node.querySelector('#complianceDecision').value;
      const note = dialog.node.querySelector('#complianceNote').value.trim();
      if (note.length < 3) return notice('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร', 'error');
      const metadata = { identity_verified: dialog.node.querySelector('#identityVerified').checked, license_number: dialog.node.querySelector('#licenseNumber').value.trim(), license_expiry: dialog.node.querySelector('#licenseExpiry').value, insurance_expiry: dialog.node.querySelector('#insuranceExpiry').value };
      const button = dialog.node.querySelector('#saveCompliance');
      button.disabled = true;
      try {
        await invoke({ action: 'review_rider_compliance', rider_id: rider.id, decision, note, metadata });
        notice(decision === 'approved' ? 'อนุมัติไรเดอร์แล้ว' : 'บันทึกให้ไรเดอร์แก้ไขเอกสารแล้ว');
        dialog.close();
        location.reload();
      } catch (error) {
        button.disabled = false;
        notice(error.message, 'error');
      }
    };
  }

  function enhance() {
    document.querySelectorAll('[data-rider-edit]').forEach(button => {
      const actionBox = button.parentElement;
      if (!actionBox || actionBox.querySelector('[data-rider-compliance]')) return;
      const reviewButton = document.createElement('button');
      reviewButton.type = 'button';
      reviewButton.className = 'mpa-button mpa-button-secondary';
      reviewButton.textContent = 'ตรวจเอกสาร';
      reviewButton.dataset.riderCompliance = button.dataset.riderEdit;
      reviewButton.onclick = () => review(reviewButton.dataset.riderCompliance).catch(error => notice(error.message || 'โหลดข้อมูลการตรวจเอกสารไม่สำเร็จ', 'error'));
      actionBox.append(reviewButton);
    });
  }

  const observer = new MutationObserver(() => requestAnimationFrame(enhance));
  observer.observe(document.body, { childList: true, subtree: true });
  enhance();
  addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
