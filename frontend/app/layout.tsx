import "./globals.css";
import { Toaster } from "react-hot-toast";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Sistema Pulsar - Universo ABA",
  description: "Sistema Pulsar",

  manifest: "/manifest.json",

  // Declarar `icons` aqui é intencional: quando este campo existe, o Next ignora
  // por completo os ícones por convenção de arquivo (app/icon.*) — ver o guard
  // `if (!resolvedMetadata.icons)` em resolve-metadata.js. É o que garante que só
  // este ícone valha, mesmo que sobre um app/icon.svg antigo na árvore de build.
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/icon-192.png",
  },

  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pulsar",
  },
};

export const viewport: Viewport = {
  themeColor: '#3A8FB7',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <head>
        {/*
          Aplica o tema salvo ANTES da primeira pintura, para a página não
          aparecer clara e piscar para escura.

          `ROTAS_SEMPRE_CLARAS` é a exceção: telas públicas que qualquer pessoa
          abre por link, sem conta. Elas não têm variante escura — pintam cores
          fixas em estilo inline, que o shim de `.dark` do globals.css não
          alcança. Sem esta checagem o cartão vinha quase preto com o texto
          continuando escuro em cima, ilegível, até a hidratação corrigir mais de
          um segundo depois. Corrigir aqui, e não num efeito da página, é o que
          elimina a piscada: quem decide é o mesmo script que a causava.

          Manter em sincronia com `ROTAS_SEMPRE_CLARAS` em lib/tema.ts.
        */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');var c=/^\\/(ficha-escolar|disponibilidade-paciente)(\\/|$)/.test(location.pathname);if(t==='dark'&&!c)document.documentElement.classList.add('dark');}catch(e){}` }} />
      </head>
      <body>
        <ServiceWorkerRegistration />
        {children}

        {/* TOAST GLOBAL */}
        <Toaster
  position="top-center"
  toastOptions={{
    style: {
      borderRadius: '10px',
      background: '#3A8FB7',
      color: '#fff',
      fontSize: '14px',
    },
  }}
/>
      </body>
    </html>
  );
}
