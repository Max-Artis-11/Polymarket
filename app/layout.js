import "./globals.css";

export const metadata = {
  title: "PolyPaper · BTC Up/Down 5m",
  description: "Free paper trader for Polymarket's Bitcoin Up or Down 5-minute markets",
};

// Applies the saved theme before first paint so there's no dark/light flash.
const themeScript = `try{var t=localStorage.getItem('polypaper-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
