import { Icon } from "./glyphs.tsx";

/**
 * Rappel fixe sous une demande en attente : la signature se fait ailleurs. Ce
 * tableau ne détient aucune clé et n'émet que des lectures ; la ligne pointillée
 * est décorative, ce n'est ni un champ ni un bouton.
 */
export function BlocASigner() {
  return (
    <div className="a-signer" data-testid="a-signer">
      <Icon name="sans-cle" />
      <div>
        <p>
          <strong>À signer par l'approbateur, hors dashboard.</strong> Ce tableau ne détient aucune clé : il montre la décision, il ne la prend pas.
        </p>
        <div className="ligne-signature" aria-hidden="true">
          <span>Signature</span>
          <i />
          <span>à apposer hors dashboard</span>
        </div>
      </div>
    </div>
  );
}
