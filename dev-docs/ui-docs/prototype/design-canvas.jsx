function DesignCanvas({children}) {
  return (
    <main style={{
      minHeight: '100vh',
      padding: 28,
      paddingRight: 292,
      boxSizing: 'border-box',
      background: '#f0eee9',
      color: 'var(--ink)',
      fontFamily: "'Inter', system-ui, sans-serif"
    }}>
      {children}
    </main>
  );
}

function DCSection({id, title, subtitle, children}) {
  return (
    <section id={id} style={{marginBottom: 42}}>
      <div style={{marginBottom: 16}}>
        <div style={{fontSize: 22, fontWeight: 800, letterSpacing: '-.01em'}}>{title}</div>
        <div style={{fontSize: 13, color: 'var(--ink-3)', marginTop: 5}}>{subtitle}</div>
      </div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start'}}>
        {children}
      </div>
    </section>
  );
}

function DCArtboard({id, label, width, height, children}) {
  return (
    <article id={id} style={{display: 'grid', gap: 8}}>
      <div style={{fontSize: 12, fontWeight: 750, color: 'var(--ink-2)'}}>{label}</div>
      <div style={{
        width,
        height,
        border: '1.5px solid rgba(31,29,26,.35)',
        borderRadius: 10,
        background: 'var(--paper)',
        overflow: 'hidden',
        boxShadow: '0 18px 36px rgba(31,29,26,.1)'
      }}>
        {children}
      </div>
    </article>
  );
}

window.DesignCanvas = DesignCanvas;
window.DCSection = DCSection;
window.DCArtboard = DCArtboard;
