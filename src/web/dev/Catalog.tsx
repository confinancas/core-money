import { type ReactNode, useState } from "react";
import { IconeCaixa } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { GlassBubble } from "@/components/ui/glass-bubble";
import { GreenTop } from "@/components/ui/green-top";
import { HiddenItem } from "@/components/ui/hidden-item";
import { EyeToggle } from "@/components/ui/hide-values";
import { Money } from "@/components/ui/money";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonCard } from "@/components/ui/skeleton";
import { SpendTypeLabel } from "@/components/ui/spend-type";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { TopIconButton } from "@/components/ui/top-icon-button";
import { SPEND_TYPES } from "../../shared/spend-types";

// Catálogo dos componentes do design system, com valores fictícios. Só existe em `npm run dev`
// e no build --mode e2e; o build de produção não o inclui (scripts/dev/check-build.mjs confere).

const PERIODOS = [
  { value: "mes", label: "Mês" },
  { value: "ciclo", label: "Ciclo" },
  { value: "ano", label: "Ano" },
];

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-[12px] font-bold uppercase tracking-[1px] text-ink-2">{titulo}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Catalogo() {
  const confirmar = useConfirm();
  const [periodo, setPeriodo] = useState("mes");
  const [avisar, setAvisar] = useState(true);
  const [escolha, setEscolha] = useState("so-eu");
  const [resultado, setResultado] = useState("");
  const [tentativas, setTentativas] = useState(0);

  async function perguntar(opcoes: Parameters<typeof confirmar>[0]) {
    const confirmado = await confirmar(opcoes);
    setResultado(confirmado ? "Confirmado" : "Cancelado");
  }

  return (
    <div className="min-h-dvh pb-10">
      <GreenTop eyebrow="Só para desenvolvimento" title="Catálogo do design system" actions={<EyeToggle />} />

      <div
        data-testid="grade-do-catalogo"
        className="mx-auto mt-6 grid max-w-[1200px] grid-cols-1 gap-5 px-4 tablet:grid-cols-2 tablet:px-6 desktop:grid-cols-3"
      >
        <Secao titulo="Botões">
          <div className="flex flex-col gap-3">
            <Button>Primário</Button>
            <Button variant="secondary">Secundário</Button>
            <Button full>Largura total</Button>
            <Button loading>Salvando</Button>
            <Button disabled>Desabilitado</Button>
          </div>
        </Secao>

        <Secao titulo="Cartão">
          <Card>Cartão padrão</Card>
          <Card variant="insight">Cartão insight</Card>
        </Secao>

        <Secao titulo="Topo">
          <GreenTop variant="detail" title="Detalhe da compra" back={{ to: "#detalhe", label: "Voltar" }} />
          <GreenTop variant="form" title="Nova conta" close={{ to: "#nova-conta", label: "Fechar" }} />
        </Secao>

        <Secao titulo="Ícones e bolha">
          <div className="flex flex-wrap items-center gap-3 rounded-card bg-(image:--gradient-top) p-4">
            <TopIconButton label="Notificações" icon={<IconeCaixa />} />
            <TopIconButton label="Notificações com 3" icon={<IconeCaixa />} badge={3} />
            <TopIconButton label="Notificações com 12" icon={<IconeCaixa />} badge={12} />
            <TopIconButton label="Só do lar" icon={<IconeCaixa />} pressed onClick={() => undefined} />
            <GlassBubble className="text-[13px] font-semibold">Bolha de vidro</GlassBubble>
          </div>
        </Secao>

        <Secao titulo="Segmentado">
          <Segmented label="Período" options={PERIODOS} value={periodo} onChange={setPeriodo} />
        </Secao>

        <Secao titulo="Chave">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[15px] font-semibold text-ink">Avisar no limite</span>
            <Switch label="Avisar no limite" checked={avisar} onCheckedChange={setAvisar} />
          </div>
        </Secao>

        <Secao titulo="Chips">
          <div className="flex flex-wrap gap-2">
            <Chip selected>Todas</Chip>
            <Chip count={3}>Mercado</Chip>
            <Chip count={12}>Lazer</Chip>
          </div>
        </Secao>

        <Secao titulo="Escolha">
          <div role="radiogroup" aria-label="Quem paga" className="grid gap-2 tablet:grid-cols-2">
            <ChoiceTile label="Só eu" selected={escolha === "so-eu"} onSelect={() => setEscolha("so-eu")} />
            <ChoiceTile
              label="Nós dois"
              selected={escolha === "nos-dois"}
              onSelect={() => setEscolha("nos-dois")}
            />
            <ChoiceTile
              label="Fixos do mês"
              dotColor={SPEND_TYPES[0].color}
              selected={escolha === "fixos"}
              onSelect={() => setEscolha("fixos")}
            />
          </div>
        </Secao>

        <Secao titulo="Campo de texto">
          <TextField label="Nome da conta" hint="Como você quer ver a conta no app." />
          <TextField label="Valor" error="Informe um valor." />
        </Secao>

        <Secao titulo="Valores">
          <div className="flex flex-col gap-2 text-[22px] font-extrabold text-ink">
            <Money cents={641000} />
            <Money cents={1076966} />
            <Money cents={-5097} />
            <Money cents={150000} sign="always" />
            <Money cents={0} sign="always" />
            <Money cents={123456789} />
            <Money cents={99} />
          </div>
        </Secao>

        <Secao titulo="Item oculto">
          <HiddenItem reason="gasto_terceiros">
            <div className="flex items-center justify-between gap-3 text-[15px] font-semibold">
              <span>[TEST] Jantar com amigos</span>
              <Money cents={-8900} struck />
            </div>
          </HiddenItem>
          <HiddenItem reason="reembolso_terceiros">
            <div className="flex items-center justify-between gap-3 text-[15px] font-semibold">
              <span>[TEST] Reembolso do jantar</span>
              <Money cents={4450} struck />
            </div>
          </HiddenItem>
        </Secao>

        <Secao titulo="Tipos de gasto">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SPEND_TYPES.map((tipo) => (
              <SpendTypeLabel key={tipo.id} type={tipo.id} />
            ))}
          </div>
        </Secao>

        <Secao titulo="Pílulas de estado">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="aviso">Atenção</StatusPill>
            <StatusPill tone="falta">Falta pagar</StatusPill>
            <StatusPill tone="sucesso">Em dia</StatusPill>
          </div>
        </Secao>

        <Secao titulo="Estados">
          <EmptyState
            title="Nenhuma conta ainda"
            description="Adicione uma conta para ver os saldos aqui."
            action={<Button variant="secondary">Adicionar conta</Button>}
          />
          <ErrorState onRetry={() => setTentativas((atual) => atual + 1)} />
          <p className="text-[13px] text-ink-2">Tentativas de nova carga: {tentativas}</p>
          <ErrorState offline onRetry={() => undefined} />
          <SkeletonCard />
        </Secao>

        <Secao titulo="Confirmação">
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                void perguntar({
                  title: "Confirmar a ação?",
                  description: (
                    <>
                      Valor da conta: <Money cents={-5097} />
                    </>
                  ),
                  confirmLabel: "Confirmar",
                });
              }}
            >
              Abrir confirmação
            </Button>
            <Button
              className="bg-danger shadow-none"
              onClick={() => {
                void perguntar({
                  title: "Excluir esta conta?",
                  description: "Não dá para desfazer.",
                  confirmLabel: "Excluir",
                  tone: "danger",
                });
              }}
            >
              Excluir
            </Button>
          </div>
          <p aria-live="polite" className="text-[15px] font-semibold text-ink">
            {resultado}
          </p>
        </Secao>
      </div>
    </div>
  );
}
