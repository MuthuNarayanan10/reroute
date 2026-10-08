import { Link } from 'react-router-dom';

export function NoStore() {
  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div className="empty" style={{ textAlign: 'left', padding: 12 }}>
        <h3>Connect your first store</h3>
        <p>ReRoute needs your orders before it can rescue parcels. Connecting Shopify takes about two minutes.</p>
        <div style={{ marginTop: 18 }}><Link className="btn btn-ink" to="/app/connect">Connect a store</Link></div>
      </div>
    </div>
  );
}
