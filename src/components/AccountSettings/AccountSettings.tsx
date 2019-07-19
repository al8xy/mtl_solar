import React from "react"
import Dialog from "@material-ui/core/Dialog"
import List from "@material-ui/core/List"
import ListItemText from "@material-ui/core/ListItemText"
import Slide from "@material-ui/core/Slide"
import red from "@material-ui/core/colors/red"
import DeleteIcon from "@material-ui/icons/Delete"
import { Account } from "../../context/accounts"
import { SettingsContext } from "../../context/settings"
import { useRouter } from "../../hooks"
import { matchesRoute } from "../../lib/routes"
import * as routes from "../../routes"
import AccountDeletionDialog from "../Dialog/AccountDeletion"
import ChangePasswordDialog from "../Dialog/ChangePassword"
import ExportKeyDialog from "../Dialog/ExportKey"
import ManageSignersDialog from "../Dialog/ManageSigners"
import AccountSettingsItem from "./AccountSettingsItem"

const SidewaysTransition = (props: any) => <Slide {...props} direction="left" />
const VerticalTransition = (props: any) => <Slide {...props} direction="up" />

function SettingsDialogs(props: Props) {
  const router = useRouter()

  const showChangePassword = matchesRoute(router.location.pathname, routes.changeAccountPassword("*"))
  const showDeleteAccount = matchesRoute(router.location.pathname, routes.deleteAccount("*"))
  const showExportKey = matchesRoute(router.location.pathname, routes.exportSecretKey("*"))
  const showManageSigners = matchesRoute(router.location.pathname, routes.manageAccountSigners("*"))

  const navigateTo = React.useMemo(
    () => ({
      accountSettings: () => router.history.push(routes.accountSettings(props.account.id)),
      allAccounts: () => router.history.push(routes.allAccounts())
    }),
    [router.history, props.account]
  )

  return (
    <>
      <Dialog
        open={showManageSigners}
        fullScreen
        onClose={navigateTo.accountSettings}
        TransitionComponent={SidewaysTransition}
      >
        <ManageSignersDialog account={props.account} onClose={navigateTo.accountSettings} />
      </Dialog>
      <Dialog open={showChangePassword} onClose={navigateTo.accountSettings} TransitionComponent={VerticalTransition}>
        <ChangePasswordDialog account={props.account} onClose={navigateTo.accountSettings} />
      </Dialog>
      <Dialog
        open={showDeleteAccount}
        fullScreen
        onClose={navigateTo.accountSettings}
        TransitionComponent={SidewaysTransition}
      >
        <AccountDeletionDialog
          account={props.account}
          onClose={navigateTo.accountSettings}
          onDeleted={navigateTo.allAccounts}
        />
      </Dialog>
      <Dialog
        open={showExportKey}
        fullScreen
        onClose={navigateTo.accountSettings}
        TransitionComponent={SidewaysTransition}
      >
        <ExportKeyDialog account={props.account} onClose={navigateTo.accountSettings} variant="export" />
      </Dialog>
    </>
  )
}

interface Props {
  account: Account
}

function AccountSettings(props: Props) {
  const router = useRouter()
  const settings = React.useContext(SettingsContext)

  const navigateTo = React.useMemo(
    () => ({
      changePassword: () => router.history.push(routes.changeAccountPassword(props.account.id)),
      deleteAccount: () => router.history.push(routes.deleteAccount(props.account.id)),
      exportSecretKey: () => router.history.push(routes.exportSecretKey(props.account.id)),
      manageSigners: () => router.history.push(routes.manageAccountSigners(props.account.id))
    }),
    [router.history, props.account]
  )

  return (
    <>
      <List style={{ padding: "24px 16px" }}>
        {settings.multiSignature ? (
          <AccountSettingsItem onClick={navigateTo.manageSigners}>
            <ListItemText
              primary="Multi-Signature"
              secondary="Make this account multi-signature, add new co-signers or remove existing ones."
            />
          </AccountSettingsItem>
        ) : null}
        <AccountSettingsItem onClick={navigateTo.changePassword}>
          <ListItemText
            primary={props.account.requiresPassword ? "Change Password" : "Set Password"}
            secondary={
              props.account.requiresPassword
                ? "Your account is protected by a password."
                : "Your account is not protected."
            }
          />
        </AccountSettingsItem>
        <AccountSettingsItem onClick={navigateTo.exportSecretKey}>
          <ListItemText
            primary="Export Secret Key"
            secondary="Decrypt and show your private key. We strongly advise you to save a backup of your secret key."
          />
        </AccountSettingsItem>
        <AccountSettingsItem
          icon={<DeleteIcon style={{ color: red[400], fontSize: "80%" }} />}
          onClick={navigateTo.deleteAccount}
        >
          <ListItemText
            primary={<span style={{ color: red["500"] }}>Merge or Delete Account</span>}
            secondary={
              <span style={{ color: red["400"] }}>
                Delete this account. Optionally merge the remaining funds into another account.
              </span>
            }
            style={{ color: red[500] }}
          />
        </AccountSettingsItem>
      </List>
      <SettingsDialogs account={props.account} />
    </>
  )
}

export default React.memo(AccountSettings)
