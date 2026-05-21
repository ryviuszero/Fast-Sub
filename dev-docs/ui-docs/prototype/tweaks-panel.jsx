function useTweaks(defaults) {
  const [state, setState] = React.useState(defaults);
  const setTweak = React.useCallback((key, value) => {
    setState((current) => ({...current, [key]: value}));
  }, []);
  return [state, setTweak];
}

function TweaksPanel({children}) {
  return (
    <aside style={{
      position: 'fixed',
      top: 16,
      right: 16,
      width: 248,
      maxHeight: 'calc(100vh - 32px)',
      overflow: 'auto',
      padding: 14,
      boxSizing: 'border-box',
      border: '1.5px solid var(--ink)',
      borderRadius: 8,
      background: 'rgba(251,250,246,.96)',
      boxShadow: '0 18px 40px rgba(31,29,26,.14)',
      fontFamily: "'Inter', system-ui, sans-serif"
    }}>
      <div style={{fontSize: 13, fontWeight: 850, marginBottom: 10}}>Prototype controls</div>
      <div style={{display: 'grid', gap: 10}}>{children}</div>
    </aside>
  );
}

function TweakSection({label}) {
  return <div style={{fontSize: 11, fontWeight: 850, color: 'var(--ink-3)', textTransform: 'uppercase', marginTop: 4}}>{label}</div>;
}

function TweakRadio({label, value, options, onChange}) {
  return (
    <label style={{display: 'grid', gap: 7}}>
      <span style={{fontSize: 12, fontWeight: 750}}>{label}</span>
      <span style={{display: 'grid', gap: 6}}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              height: 30,
              border: '1.3px solid var(--ink)',
              borderRadius: 6,
              background: value === option.value ? 'var(--ink)' : 'var(--paper)',
              color: value === option.value ? 'var(--paper)' : 'var(--ink)',
              font: 'inherit',
              fontSize: 12,
              fontWeight: 750,
              cursor: 'pointer'
            }}
          >
            {option.label}
          </button>
        ))}
      </span>
    </label>
  );
}

window.useTweaks = useTweaks;
window.TweaksPanel = TweaksPanel;
window.TweakSection = TweakSection;
window.TweakRadio = TweakRadio;
