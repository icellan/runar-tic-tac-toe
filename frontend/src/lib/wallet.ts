import { WalletClient, type SecurityLevel } from '@bsv/sdk'
import { WalletSigner } from 'runar-sdk'

export const PROTOCOL_ID: [SecurityLevel, string] = [2 as SecurityLevel, 'tic tac toe']
export const KEY_ID = '1'

export const wallet = new WalletClient()
export const signer = new WalletSigner({ protocolID: PROTOCOL_ID, keyID: KEY_ID, wallet })
