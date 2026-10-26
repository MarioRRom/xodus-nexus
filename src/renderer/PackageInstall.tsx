import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CatalogProduct, InstallPlan, InstallRequest } from '../shared/types';
import { estimatedInstallBytes, installByteLabel } from '../shared/install-storage';

export function catalogInstallRequest(product: Pick<CatalogProduct, 'productId' | 'installProductId' | 'title'>, destination: string): InstallRequest {
  return { productId: product.productId, title: product.title, destination };
}

type Install = (request: InstallRequest) => Promise<string | undefined>;
const InstallContext = createContext<Install>(async () => { throw Error("Installation dialog is unavailable."); });
export const usePackageInstall = () => useContext(InstallContext);

export async function confirmedPackageInstall(request: InstallRequest,
  api: Pick<Window['launcher'], 'getInstallPlan' | 'startInstall'>,
  confirm: (plan: InstallPlan) => Promise<string | undefined>, mounted: () => boolean): Promise<string | undefined> {
  const result = await api.getInstallPlan(request.productId, request.destination);
  if (!mounted()) return;
  if (result.status === 'unavailable') throw Error("No supported Windows.Desktop MSIXVC package was found for this Store offer.");
  const selected = await confirm(result);
  if (!selected || !mounted()) return;
  return api.startInstall({ ...request, selectedContentId: selected, selectionMarket: result.market });
}

export function PackageDialog({ plan, choose, destination }: { plan: InstallPlan; choose: (id?: string) => void; destination?: string }) {
  const [selected, setSelected] = useState(() => plan.status === 'ready' ? plan.choices.find(item => item.supported)?.contentId ?? '' : '');
  const choice = plan.choices.find(item => item.contentId === selected);
  const estimated = estimatedInstallBytes(choice);
  const lowSpace = estimated !== undefined && plan.availableBytes !== undefined && estimated > plan.availableBytes;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') choose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose]);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) choose(); }}>
    <section className="game-dialog package-dialog" role="dialog" aria-modal="true" aria-labelledby="package-dialog-title">
      <h2 id="package-dialog-title">{plan.status === 'ready' ? "Install game" : "Choose files to install"}</h2>
      <p>{plan.status === 'ready' ? "Review the installation before downloading." : "Choose the package you want to install from this Store offer."}{' '}{"Xodus checks your license before downloading."}</p>
      <div className="package-choices">{plan.choices.map(item => <label className={`package-choice${item.supported ? '' : ' unsupported'}`} key={`${item.productId}:${item.contentId}`}>
        <input type="radio" name="install-package" value={item.contentId} disabled={!item.supported} checked={selected === item.contentId} onChange={() => setSelected(item.contentId)} />
        <span><strong>{item.title}</strong><small>{item.platform || "Unknown platform"} · {item.packageFormat || "Unknown format"}{['GameAddOn', 'Durable'].includes(item.kind) ? " · Add-on" : ''}{!item.supported ? " · Unsupported" : ''}</small><small>{`Estimated download: ${installByteLabel(item.downloadBytes)}`}</small><small>{`Store ID ${item.productId}`}</small></span>
      </label>)}</div>
      <div className="install-storage" aria-label={"Installation storage"}>
        {destination ? <p className="install-destination" title={destination}>{destination}</p> : null}
        <dl><div><dt>{"Estimated space"}</dt><dd>{installByteLabel(estimated)}</dd></div><div><dt>{"Available on target drive"}</dt><dd>{installByteLabel(plan.availableBytes)}</dd></div></dl>
        {lowSpace ? <p className="warning-text" role="status">{"The estimate exceeds available space. Existing files may be reused; the downloader checks the actual space required."}</p> : <small>{"Sizes are estimates. The downloader checks actual space before transferring files."}</small>}
      </div>
      <div className="dialog-actions"><button className="secondary" data-gamepad-cancel onClick={() => choose()}>{"Cancel"}</button><button className="primary" disabled={!selected} onClick={() => choose(selected)}>{plan.status === 'ready' ? "Install" : "Install selected package"}</button></div>
    </section>
  </div>;
}

export function PackageInstallProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{plan: InstallPlan; destination: string}>();
  const pending = useRef<((id?: string) => void)>();
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.(); }; }, []);
  function choose(id?: string) { pending.current?.(id); pending.current = undefined; setDialog(undefined); }
  const install: Install = async request => {
    if (busy.current) throw Error("Finish the current package selection first.");
    busy.current = true;
    try {
      return await confirmedPackageInstall(request, window.launcher,
        result => new Promise<string | undefined>(resolve => { pending.current = resolve; setDialog({plan: result, destination: request.destination}); }),
        () => mounted.current);
    } finally { busy.current = false; }
  };
  return <InstallContext.Provider value={install}>{children}{dialog ? <PackageDialog plan={dialog.plan} destination={dialog.destination} choose={choose} /> : null}</InstallContext.Provider>;
}
