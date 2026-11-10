import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { TopIconButton } from "@/components/ui/top-icon-button";
import type { ConnectionDto } from "../../../shared/pluggy-api";
import { MENSAGEM_ITEM_NAO_ENCONTRADO } from "../../../shared/pluggy-api";
import { StepBar } from "../../access/StepBar";
import {
  adicionarBancos,
  criarConexao,
  listarConexoes,
  previewBancos,
  testarChaves,
  trocarChaves,
} from "../../api/pluggy";
import { IconeSeta } from "../../components/icons";
import { ApiError, mensagemDoErro } from "../../lib/api";
import { useSession } from "../../session/SessionProvider";
import { type CartaoDeBanco, StepBancos } from "./conectar/StepBancos";
import { type ChavesDaTela, StepChaves } from "./conectar/StepChaves";
import { StepNome } from "./conectar/StepNome";
import { StepPronto } from "./conectar/StepPronto";
import {
  erroDoRotulo,
  nomeSugerido,
  type Passo,
  podeContinuarDasChaves,
  TITULOS_DOS_PASSOS,
  TOTAL_DE_PASSOS,
  textoDoBancoJaConectado,
} from "./conectar/view-model";

type Resultado = { rotulo: string; quantidade: number };

const CHAVES_VAZIAS: ChavesDaTela = { clientId: "", clientSecret: "" };
const AVISO_DAS_CHAVES_TROCADAS = "Chaves trocadas.";

// Coluna dos passos (ConectarPluggy*.dc.html): o celular tem 16 px de cada lado; o tablet usa a área ao lado do menu
// (96 px) com 24 px; o desktop é uma coluna de 720 px encostada à esquerda da área (252 px de menu, 32 px de margem).
// No desktop, o máximo inclui as margens de 32 px: 784 px dão um cartão de 720 px (com a borda do box-sizing).
const COLUNA = "w-full px-4 -mt-10 tablet:px-6 desktop:max-w-[784px] desktop:px-8";

// Conectar Meu Pluggy (/configuracoes/bancos/conectar, TASK-0203): quatro passos com as chaves testadas antes de
// gravar. Dois atalhos: ?conexao=<id> abre no passo 3 (outro banco desta conta); ?conexao=<id>&trocar=chaves abre
// só o passo 2 (troca das chaves, e volta para Configurações com o aviso).
export function ConectarPluggy() {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const { member } = useSession();
  const conexaoId = parametros.get("conexao");
  const trocaPedida = parametros.get("trocar") === "chaves";

  const [carregando, setCarregando] = useState(true);
  const [falhouACarga, setFalhouACarga] = useState(false);
  const [conexao, setConexao] = useState<ConnectionDto | null>(null);
  const [passo, setPasso] = useState<Passo>(1);
  const [trocando, setTrocando] = useState(trocaPedida);
  const [nome, setNome] = useState("");
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [chaves, setChaves] = useState<ChavesDaTela>(CHAVES_VAZIAS);
  const [testado, setTestado] = useState(false);
  const [testando, setTestando] = useState(false);
  const [erroChaves, setErroChaves] = useState<string | null>(null);
  const [salvandoChaves, setSalvandoChaves] = useState(false);
  const [bancos, setBancos] = useState<CartaoDeBanco[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [erroDoId, setErroDoId] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  // Espelha o envio em andamento: dois cliques antes do re-render não mandam duas chamadas.
  const travado = useRef(false);

  const rotulo = conexao?.label ?? nome.trim();
  const chavesLimpas = { clientId: chaves.clientId.trim(), clientSecret: chaves.clientSecret.trim() };

  // Carga inicial: a lista de conexões (para o nome sugerido e para a conta de ?conexao=).
  const carregar = useCallback(async () => {
    setFalhouACarga(false);
    try {
      const { connections } = await listarConexoes();
      const rotulos = connections.map((conexaoDaLista) => conexaoDaLista.label);
      if (conexaoId === null) {
        setNome(nomeSugerido(member.name, rotulos));
        return;
      }
      const achada = connections.find((conexaoDaLista) => conexaoDaLista.id === conexaoId) ?? null;
      if (achada === null) {
        setFalhouACarga(true);
        return;
      }
      setConexao(achada);
      // Sem chaves guardadas, o caminho é colar as chaves de novo antes de autorizar outro banco.
      if (!achada.hasKeys || trocaPedida) {
        setTrocando(true);
        setPasso(2);
      } else {
        setPasso(3);
      }
    } catch {
      setFalhouACarga(true);
    } finally {
      setCarregando(false);
    }
  }, [conexaoId, trocaPedida, member.name]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function mudarChave(campo: keyof ChavesDaTela, valor: string) {
    setChaves((atual) => ({ ...atual, [campo]: valor }));
    setTestado(false);
    setErroChaves(null);
  }

  async function testar() {
    if (travado.current) return;
    travado.current = true;
    setTestando(true);
    setErroChaves(null);
    try {
      await testarChaves(chavesLimpas);
      setTestado(true);
    } catch (falha) {
      setTestado(false);
      setErroChaves(mensagemDoErro(falha));
    } finally {
      travado.current = false;
      setTestando(false);
    }
  }

  async function salvarChaves() {
    if (conexao === null || travado.current) return;
    travado.current = true;
    setSalvandoChaves(true);
    setErroChaves(null);
    try {
      await trocarChaves(conexao.id, chavesLimpas);
      navegar("/configuracoes", { state: { aviso: AVISO_DAS_CHAVES_TROCADAS } });
    } catch (falha) {
      setErroChaves(mensagemDoErro(falha));
    } finally {
      travado.current = false;
      setSalvandoChaves(false);
    }
  }

  function continuarDoNome() {
    const erro = erroDoRotulo(nome);
    setErroNome(erro);
    if (erro === null) setPasso(2);
  }

  async function adicionarId(itemId: string) {
    if (travado.current) return;
    if (bancos.some((banco) => banco.itemId === itemId)) {
      setErroDoId("Este id já está na lista.");
      return;
    }
    travado.current = true;
    setAdicionando(true);
    setErroDoId(null);
    try {
      const origem = conexao !== null ? { connectionId: conexao.id } : { chaves: chavesLimpas };
      const previa = await previewBancos(origem, [itemId]);
      const item = previa.items[0];
      if (item === undefined || "error" in item) {
        setErroDoId(MENSAGEM_ITEM_NAO_ENCONTRADO);
        return;
      }
      setBancos((atuais) => [
        ...atuais,
        {
          itemId,
          nomeDeduzido: item.institutionName,
          cor: item.institutionColor,
          resumo: item.summary,
          consentExpiresAt: item.consentExpiresAt,
          jaConectado: item.alreadyConnected,
          selecionado: !item.alreadyConnected,
          nomeDigitado: "",
          erro: item.alreadyConnected ? textoDoBancoJaConectado() : null,
        },
      ]);
    } catch (falha) {
      setErroDoId(mensagemDoErro(falha));
      if (falha instanceof ApiError && falha.code === "chaves_invalidas") setTestado(false);
    } finally {
      travado.current = false;
      setAdicionando(false);
    }
  }

  function escolherBanco(itemId: string) {
    setBancos((atuais) =>
      atuais.map((banco) =>
        banco.itemId === itemId && !banco.jaConectado ? { ...banco, selecionado: !banco.selecionado } : banco,
      ),
    );
  }

  function nomearBanco(itemId: string, nomeDigitado: string) {
    setBancos((atuais) =>
      atuais.map((banco) => (banco.itemId === itemId ? { ...banco, nomeDigitado, erro: null } : banco)),
    );
  }

  async function conectar() {
    if (travado.current) return;
    travado.current = true;
    setConectando(true);
    setErroGeral(null);
    const itens = bancos
      .filter((banco) => banco.selecionado)
      .map((banco) =>
        banco.nomeDeduzido === null
          ? { itemId: banco.itemId, institutionName: banco.nomeDigitado.trim() }
          : { itemId: banco.itemId },
      );
    try {
      if (conexao !== null) {
        await adicionarBancos(conexao.id, itens);
        setResultado({ rotulo: conexao.label, quantidade: itens.length });
      } else {
        await criarConexao({ label: nome.trim(), chaves: chavesLimpas, items: itens });
        setResultado({ rotulo: nome.trim(), quantidade: itens.length });
      }
      setPasso(4);
    } catch (falha) {
      const codigo = falha instanceof ApiError ? falha.code : "";
      if (codigo === "rotulo_em_uso") {
        setErroNome(mensagemDoErro(falha));
        setPasso(1);
      } else if (codigo === "chaves_invalidas" || codigo === "pluggy_indisponivel") {
        setErroChaves(mensagemDoErro(falha));
        setTestado(false);
        if (conexao !== null) setTrocando(true);
        setPasso(2);
      } else if (codigo === "banco_ja_conectado") {
        setErroGeral(textoDoBancoJaConectado());
      } else {
        setErroGeral(mensagemDoErro(falha));
      }
    } finally {
      travado.current = false;
      setConectando(false);
    }
  }

  function voltar() {
    if (passo === 3 && conexao !== null) navegar("/configuracoes");
    else if (passo > 1) setPasso((atual) => (atual - 1) as Passo);
  }

  const cabecalho = (
    <header className="bg-(image:--gradient-top) rounded-b-[30px] px-4 pt-4 pb-14 text-white shadow-top tablet:px-10">
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center gap-3">
          <TopIconButton
            label="Cancelar e voltar para Configurações"
            to="/configuracoes"
            icon={<IconeSeta />}
          />
          <div className="flex min-w-0 flex-col">
            <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">Conectar Meu Pluggy</h1>
            <span className="text-[13px] font-semibold text-white/82">Open Finance, só leitura</span>
          </div>
        </div>
        <StepBar
          current={passo}
          total={TOTAL_DE_PASSOS}
          label={TITULOS_DOS_PASSOS[passo - 1] ?? ""}
          variante="sobre-verde"
        />
      </div>
    </header>
  );

  if (carregando) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        {cabecalho}
        <div className={COLUNA}>
          <SkeletonCard />
        </div>
      </section>
    );
  }

  if (falhouACarga) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        {cabecalho}
        <div className={COLUNA}>
          <ErrorState
            title="Não deu para abrir esta conta."
            description="Tente de novo ou volte para Configurações."
            onRetry={() => {
              setCarregando(true);
              void carregar();
            }}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      {cabecalho}
      <div className={`${COLUNA} pb-8`}>
        <Card className="flex flex-col gap-5">
          {passo === 1 && (
            <StepNome
              nome={nome}
              aoMudar={(valor) => {
                setNome(valor);
                setErroNome(null);
              }}
              erro={erroNome}
              aoContinuar={continuarDoNome}
            />
          )}
          {passo === 2 && (
            <StepChaves
              rotulo={rotulo}
              chaves={chaves}
              aoMudar={mudarChave}
              testado={testado}
              testando={testando}
              erro={erroChaves}
              modo={trocando ? "trocar" : "nova"}
              salvando={salvandoChaves}
              aoTestar={() => void testar()}
              aoContinuar={() => {
                if (podeContinuarDasChaves(testado, testando)) setPasso(3);
              }}
              aoSalvar={() => void salvarChaves()}
              aoVoltar={voltar}
            />
          )}
          {passo === 3 && (
            <StepBancos
              rotulo={rotulo}
              bancos={bancos}
              modo={conexao !== null ? "outro-banco" : "nova"}
              cpfMascarado={conexao?.cpfMasked ?? null}
              adicionando={adicionando}
              erroDoId={erroDoId}
              erroGeral={erroGeral}
              enviando={conectando}
              aoAdicionar={(id) => void adicionarId(id)}
              aoEscolher={escolherBanco}
              aoNomear={nomearBanco}
              aoConectar={() => void conectar()}
              aoVoltar={voltar}
            />
          )}
          {passo === 4 && resultado !== null && (
            <StepPronto
              rotulo={resultado.rotulo}
              quantidade={resultado.quantidade}
              aoIrParaInicio={() => navegar("/inicio")}
              aoVerEmConfiguracoes={() => navegar("/configuracoes")}
            />
          )}
        </Card>
      </div>
    </section>
  );
}
