import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { BankItemDto, ConnectionDto, ConnectionsResponse } from "../../../shared/pluggy-api";
import { listarConexoes } from "../../api/pluggy";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { cpfParaTela, estadoDaConexao, siglaDoBanco, subtituloDoBanco } from "../bancos/conectar/view-model";

const CAMINHO_DO_CONECTAR = "/configuracoes/bancos/conectar";

// Seção Contas Meu Pluggy (TASK-0203): as conexões do lar, os bancos de cada uma e a troca das chaves. Os dados vêm de
// GET /api/pluggy-connections (sem chaves). Quem entra no app vê as mesmas contas: não depende de quem está logado.
export function SectionContasMeuPluggy() {
  const navegar = useNavigate();
  const localizacao = useLocation();
  const aviso = (localizacao.state as { aviso?: string } | null)?.aviso;
  const [dados, setDados] = useState<ConnectionsResponse | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      setDados(await listarConexoes());
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (dados === null) {
    return falhou ? (
      <ErrorState title="Não deu para carregar as contas." onRetry={() => void carregar()} />
    ) : (
      <SkeletonCard />
    );
  }

  const agora = new Date();
  const conexoes = dados.connections;

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-[13px] leading-normal text-ink-2">
        Cada conta do Meu Pluggy é de um CPF e não depende de quem entra no app. Os dados de todas entram
        juntos, sem separar por pessoa.
      </p>

      {aviso !== undefined && (
        <p
          role="status"
          className="rounded-field bg-success-bg px-3.5 py-3 text-[13px] font-semibold text-success-ink"
        >
          {aviso}
        </p>
      )}

      {conexoes.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma conta Meu Pluggy ainda"
            action={<Button onClick={() => navegar(CAMINHO_DO_CONECTAR)}>Conectar conta Meu Pluggy</Button>}
          />
        </Card>
      ) : (
        conexoes.map((conexao) => <CartaoDaConexao key={conexao.id} conexao={conexao} agora={agora} />)
      )}

      {conexoes.length > 0 && (
        <Card className="flex flex-col overflow-hidden p-0">
          <SettingsRow titulo="Conectar outra conta Meu Pluggy" para={CAMINHO_DO_CONECTAR} />
        </Card>
      )}
    </div>
  );
}

// Um cartão por conexão: o rótulo, o CPF, o selo, uma linha por banco e as duas ações (outro banco, trocar chaves).
function CartaoDaConexao({ conexao, agora }: { conexao: ConnectionDto; agora: Date }) {
  const estado = estadoDaConexao(conexao);
  const cpf = cpfParaTela(conexao.cpfMasked);
  const subtitulo = cpf === null ? "Meu Pluggy" : `Meu Pluggy · ${cpf}`;
  const caminhoDaConta = `${CAMINHO_DO_CONECTAR}?conexao=${encodeURIComponent(conexao.id)}`;
  return (
    <Card className="flex flex-col overflow-hidden p-0 [&>*+*]:border-t [&>*+*]:border-field-border">
      <div className="flex flex-col gap-2 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[16px] font-extrabold text-ink">{conexao.label}</span>
          <StatusPill tone={estado.tom}>{estado.texto}</StatusPill>
        </div>
        <span className="text-[13px] text-ink-2">{subtitulo}</span>
        {!conexao.hasKeys && (
          <span className="text-[13px] leading-normal text-warn">
            As chaves não vêm no backup. Cole de novo para os bancos desta conta voltarem a atualizar.
          </span>
        )}
      </div>

      {conexao.bankItems.map((banco) => (
        <SettingsRow
          key={banco.id}
          inicio={<SiglaDoBanco banco={banco} />}
          titulo={banco.institutionName}
          subtitulo={subtituloDoBanco(banco, agora)}
          para={`/configuracoes/bancos/${encodeURIComponent(banco.id)}`}
        />
      ))}

      <SettingsRow titulo="Autorizar outro banco desta conta" para={caminhoDaConta} />
      <SettingsRow titulo="Trocar chaves" para={`${caminhoDaConta}&trocar=chaves`} />
    </Card>
  );
}

function SiglaDoBanco({ banco }: { banco: BankItemDto }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-[12px] text-[13px] font-extrabold text-white"
      style={{ backgroundColor: banco.institutionColor ?? "#0E9A63" }}
    >
      {siglaDoBanco(banco.institutionName)}
    </span>
  );
}
