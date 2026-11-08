import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { brand } from "../../../shared/brand";

// Passo 3 do cadastro (TASK-0103): só "Adicionar depois". O formulário do cônjuge entra na TASK-0105.
const VOCES_DOIS_VAO_PODER = [
  "Ver cartões, contas, renda e relatórios do casal",
  "Conectar a própria conta Meu Pluggy",
  "Categorizar, renomear e ocultar compras e Pix",
  "Concluir o balanço do mês e mudar as configurações",
];

export function SpouseStep() {
  const navegar = useNavigate();

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Adicione seu cônjuge</h1>
        <p className="text-[14px] leading-normal text-ink-2">
          O {brand.name} é feito para dois. Seu cônjuge entra nesta mesma conta, com a própria passkey.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-card bg-field p-4">
        <span className="text-[16px] font-extrabold">Vocês dois vão poder</span>
        {VOCES_DOIS_VAO_PODER.map((item) => (
          <span key={item} className="flex items-start gap-2.5 text-[13px] leading-normal text-ink-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-primary"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {item}
          </span>
        ))}
      </section>

      <p className="text-[13px] leading-normal text-ink-2">
        Dá para fazer isso agora ou depois, em Configurações › Casal.
      </p>

      <Button full onClick={() => navegar("/inicio")}>
        Adicionar depois
      </Button>
    </Card>
  );
}
