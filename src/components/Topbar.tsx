import Image from "next/image";
import { Nav } from "./Nav";

export function Topbar() {
  return (
    <header className="topbar">
      <div className="brand-logos">
        <Image src="/logo-mann.png" alt="MANN Tratamentos Fitossanitários" width={73} height={24} priority />
        <Image src="/logo-exata.png" alt="EXATA Ambiental" width={48} height={24} priority />
      </div>
      <div className="brand">
        <div className="brand-text">
          <h1>Certificados Madeireiras</h1>
          <span>Consultoria · cadastradas e credenciadas · preenchimento automático do SEI</span>
        </div>
      </div>
      <Nav />
    </header>
  );
}
