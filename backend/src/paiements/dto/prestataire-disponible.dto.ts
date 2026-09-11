import { ApiProperty } from '@nestjs/swagger';
import { ModePaiement, PrestatairePaiement } from '../shared/paiement.enums';

export class PrestataireDisponibleDto {
  @ApiProperty({ example: 'benin' })
  pays: string;

  @ApiProperty({
    enum: [PrestatairePaiement.KKIAPAY, PrestatairePaiement.FEDAPAY],
    example: PrestatairePaiement.KKIAPAY,
  })
  prestataire: PrestatairePaiement;

  @ApiProperty({ example: 'KKiaPay' })
  libelle: string;

  @ApiProperty({ enum: ModePaiement, example: ModePaiement.LIVE })
  mode: ModePaiement;

  @ApiProperty({ example: 'XOF' })
  devise: string;

  @ApiProperty({ example: 500, nullable: true })
  montant_min: number | null;

  @ApiProperty({ example: 500000, nullable: true })
  montant_max: number | null;
}

export class ListePrestatairesDisponiblesDto {
  @ApiProperty({ example: 'benin' })
  pays: string;

  @ApiProperty({ type: [PrestataireDisponibleDto] })
  prestataires: PrestataireDisponibleDto[];
}
