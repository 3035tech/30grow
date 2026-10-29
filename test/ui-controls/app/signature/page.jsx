'use client';
import { useRef, useState } from 'react';
import { SignaturePadField, SignatureStrokePreview } from '../../../../app/_components/SignaturePadField';
export default function SignatureTest() {
  const padRef = useRef(null);
  const [empty, setEmpty] = useState(true);
  const [saved, setSaved] = useState('');
  return <main style={{ width: 600, margin: 40 }}>
    <SignaturePadField padRef={padRef} onEmptyChange={setEmpty} height={168} />
    <output data-testid="empty">{String(empty)}</output>
    <button type="button" onClick={() => setSaved(padRef.current.toDataURL('image/png'))}>Salvar</button>
    {saved ? <SignatureStrokePreview src={saved} maxHeightClass="max-h-32" /> : null}
  </main>;
}
