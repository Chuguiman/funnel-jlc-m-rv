import { useEffect, useRef, useState } from 'react';
import { RECOVERY_KEY, readRecovery, recoveryEnvelope, type LeadInput } from '../../lib/recovery/model';
import { Checkbox } from './ui';

export function RecoveryPanel({ draft, lead }: { draft: unknown; lead: Omit<LeadInput, 'consent'> }) {
  const [save, setSave] = useState(() => { try { return typeof window !== 'undefined' && !!readRecovery(localStorage.getItem(RECOVERY_KEY)); } catch { return false; } });
  const [contact, setContact] = useState(false);
  const [whatsappContact, setWhatsappContact] = useState(false);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState('');
  const lastActivity = useRef(Date.now());
  const inFlight = useRef(false);
  const leadRef = useRef(lead);
  leadRef.current = lead;
  const draftJson = JSON.stringify(draft);
  const leadJson = JSON.stringify(lead);

  useEffect(() => {
    fetch('/api/recovery/lead').then(r => r.json()).then(data => {
      setAvailable(data.enabled === true);
      setContact(data.optedIn === true);
      setWhatsappContact(data.whatsappOptedIn === true);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    try {
      if (save) localStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryEnvelope(JSON.parse(draftJson))));
      else localStorage.removeItem(RECOVERY_KEY);
    } catch { setMessage('Este navegador no permite guardar el avance. Puedes continuar tu cotización.'); }
  }, [save, draftJson]);

  useEffect(() => {
    if (!available || !contact) return;
    let stopped = false;
    const recordActivity = () => { lastActivity.current = Date.now(); };
    const sync = async () => {
      if (stopped || inFlight.current || document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivity.current > 60000) return;
      const current = leadRef.current;
      const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(current.email ?? '');
      const hasWhatsapp = whatsappContact && !!current.whatsapp;
      if (!hasEmail && !hasWhatsapp) {
        setMessage('Añade un correo o autoriza el contacto por WhatsApp para permitir el seguimiento.'); return;
      }
      inFlight.current = true;
      try {
        const response = await fetch('/api/recovery/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(hasEmail ? { email: current.email } : {}), ...(hasWhatsapp ? { whatsapp: current.whatsapp } : {}), products: current.products, frequency: current.frequency, cartId: current.cartId, stage: current.stage, consent: true }) });
        if (!stopped) setMessage(response.ok ? 'Seguimiento guardado. JLC podrá contactarte si no terminas.' : 'No se pudo guardar el seguimiento. Tu cotización puede continuar.');
      } catch { if (!stopped) setMessage('Seguimiento pendiente por conexión. Tu cotización puede continuar.'); }
      finally { inFlight.current = false; }
    };
    document.addEventListener('pointerdown', recordActivity);
    document.addEventListener('keydown', recordActivity);
    const initial = window.setTimeout(sync, 1000);
    const interval = window.setInterval(sync, 60000);
    return () => { stopped = true; clearTimeout(initial); clearInterval(interval); document.removeEventListener('pointerdown', recordActivity); document.removeEventListener('keydown', recordActivity); };
  }, [available, contact, whatsappContact, leadJson]);

  const changeContact = async (on: boolean) => {
    setMessage('');
    if (on) {
      const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email ?? '');
      if (!hasEmail && !lead.whatsapp) {
        setMessage('Añade un correo o un teléfono venezolano para autorizar el seguimiento.'); return;
      }
      setContact(true); lastActivity.current = Date.now(); return;
    }
    // Wait for an already-started save, then revoke. Do not claim deletion on failure.
    setContact(false);
    setWhatsappContact(false);
    const revoke = async () => {
      while (inFlight.current) await new Promise(resolve => setTimeout(resolve, 100));
      try {
        const response = await fetch('/api/recovery/lead', { method: 'DELETE' });
        if (!response.ok) throw new Error();
        setMessage('Seguimiento eliminado.');
      } catch { setMessage('No pudimos cancelar el seguimiento. Pulsa de nuevo «Cancelar seguimiento» para reintentar.'); }
    };
    await revoke();
  };

  const changeWhatsapp = (on: boolean) => {
    if (on && !lead.whatsapp) {
      setMessage('Añade un número de teléfono venezolano para autorizar contacto por WhatsApp.');
      return;
    }
    setWhatsappContact(on);
    if (on) {
      setContact(true);
      lastActivity.current = Date.now();
    }
  };

  return <aside className="mt-8 rounded-2xl border border-brand-100 bg-brand-50/50 p-5">
    <h3 className="font-display font-bold text-brand-900">¿Prefieres continuar más tarde?</h3>
    <p className="mt-1 mb-4 text-sm text-slate-600">Puedes guardar tu avance durante siete días en este navegador. Al volver, revisaremos tu cotización o la solicitud que ya exista. Úsalo en un dispositivo personal.</p>
    <Checkbox label="Guardar mi avance en este navegador durante 7 días" checked={save} onChange={setSave} />
    {available && <div className="mt-3">
      <Checkbox label="Autorizo a JLC a contactarme si no termino mi solicitud (datos de seguimiento conservados hasta 7 días)." checked={contact} onChange={changeContact} />
      {lead.whatsapp && <div className="mt-3">
        <Checkbox label="También autorizo contacto manual por WhatsApp sobre esta solicitud." checked={whatsappContact} onChange={changeWhatsapp} />
        <p className="mt-2 px-1 text-xs text-slate-500">JLC revisará la solicitud y un asesor abrirá el chat manualmente. No se enviarán mensajes automáticos.</p>
      </div>}
      <button type="button" onClick={() => changeContact(false)} className="mt-2 text-sm text-brand-700 underline">Cancelar seguimiento</button>
    </div>}
    {message && <p role="status" className="mt-3 text-sm text-brand-800">{message}</p>}
  </aside>;
}
