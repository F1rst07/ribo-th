import packageJson from "../../package.json";

export default function HomePage() {
  const version = `v${packageJson.version}`;

  return (
    <div className="page">
      <div className="hazard" aria-hidden="true"></div>
      <main>
        <section className="content" aria-labelledby="status-heading">
          <div className="symbol" aria-hidden="true">
            <span className="spinning-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/refresh-ccw.svg"
                alt=""
                width={47}
                height={47}
              />
            </span>
          </div>
          <h1 id="status-heading">กำลังพัฒนาอยู่...</h1>
          <div className="badge-group">
            <span className="tag">UNDER CONSTRUCTION</span>
            <span className="version-badge" title={`เวอร์ชันของระบบ: ${version}`}>
              {version}
            </span>
          </div>
          <p className="description">ขณะนี้เว็บไซต์อยู่ระหว่างการพัฒนาและปรับปรุงระบบ</p>
          <p className="apology">ขออภัยในความไม่สะดวก</p>
        </section>
      </main>
      <footer>
        <p>© 2026 RIBO-TH. All Rights Reserved.</p>
        <p className="credit">Developed by K. Phiraphatz</p>
      </footer>
    </div>
  );
}
