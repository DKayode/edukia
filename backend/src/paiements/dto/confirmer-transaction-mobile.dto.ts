import { IsString, Length } from 'class-validator';

export class ConfirmerTransactionMobileDto {
  @IsString()
  @Length(3, 150)
  reference_prestataire: string;
}
