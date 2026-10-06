import "./globals.css";

export const metadata = {
  title: "PolyPaper · BTC Up/Down 5m",
  description: "Free paper trader for Polymarket's Bitcoin Up or Down 5-minute markets",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
