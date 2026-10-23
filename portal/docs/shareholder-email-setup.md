# Shareholder emails: Microsoft 365 setup

The investor portal reads each company's `shareholders@` mailbox and replies in
the same thread (Admin → Shareholder emails). It connects to Microsoft 365 as an
app that Exchange limits to **those mailboxes only**: it can never open anyone's
personal mailbox. All companies (lakeba.com, ezifin.com, doxai.co,
bricklet.com.au, shelfieretail.com) are in the same Microsoft 365 organisation
(tenant `b1a7c303-0faf-4874-a764-0eb184efd96e`), so this is done once.

You need: a Global Administrator (or Application Administrator + Exchange
Administrator), about 30 minutes, and the certificate file
`lakeba-portal-mail-staging.cer` (public part only; the private key never
leaves the portal server). Production gets its own certificate later.

## 1. Mailboxes

In the Exchange admin center (admin.exchange.microsoft.com) → Recipients → Mailboxes:

1. Create a **shared mailbox** for testing: `portal-test@lakeba.com` (display name "Portal test").
2. Check that each `shareholders@…` address is a **shared mailbox** (not a group or a forward).
   If one is a distribution list or forwards to a person, tell us before changing it.

## 2. Register the app (Microsoft Entra admin center)

entra.microsoft.com → Identity → Applications → **App registrations** → **New registration**:

- Name: `Lakeba Investor Portal – Mail`
- Supported account types: **Accounts in this organizational directory only**
- Redirect URI: leave empty → **Register**

On the app's **Overview**, note the **Application (client) ID**.

Then **Certificates & secrets** → **Certificates** → **Upload certificate** →
choose `lakeba-portal-mail-staging.cer`, description "staging" → **Add**.
(No client secret is needed.)

Do **not** add Microsoft Graph *Mail* permissions under **API permissions**:
the next step grants mail access, limited to the shareholder mailboxes.

Under **Enterprise applications** → `Lakeba Investor Portal – Mail` → Overview,
note the **Object ID** (of the enterprise application / service principal).

## 3. Limit it to the shareholder mailboxes (Exchange Online PowerShell)

On a computer with PowerShell:

```powershell
Install-Module ExchangeOnlineManagement   # once
Connect-ExchangeOnline

# Mark the mailboxes the portal may use (CustomAttribute15 is usually free; pick another if it's in use).
Set-Mailbox portal-test@lakeba.com -CustomAttribute15 LakebaPortal
# Later, one per company as each is switched on:
# Set-Mailbox shareholders@lakeba.com -CustomAttribute15 LakebaPortal

New-ManagementScope -Name "Lakeba portal mailboxes" -RecipientRestrictionFilter "CustomAttribute15 -eq 'LakebaPortal'"

New-ServicePrincipal -AppId <Application (client) ID> -ObjectId <Enterprise app Object ID> -DisplayName "Lakeba Investor Portal - Mail"

New-ManagementRoleAssignment -App <Application (client) ID> -Role "Application Mail.ReadWrite" -CustomResourceScope "Lakeba portal mailboxes"
New-ManagementRoleAssignment -App <Application (client) ID> -Role "Application Mail.Send" -CustomResourceScope "Lakeba portal mailboxes"
```

Check it (allow up to an hour for changes to take effect):

```powershell
Test-ServicePrincipalAuthorization -Identity <Application (client) ID> -Resource portal-test@lakeba.com   # InScope: True
Test-ServicePrincipalAuthorization -Identity <Application (client) ID> -Resource <your own address>       # InScope: False
```

## 4. Send us

- the **Application (client) ID**

That's all (the tenant ID is already known; there's no password or secret to send).
We then connect staging to `portal-test@lakeba.com` in **Review** mode and you
send it a few test emails.

## Later: production and each company

- Production: we create a separate certificate on the server and send you its
  `.cer` to upload to the same app (step 2), then switch on `shareholders@lakeba.com`
  in Review mode (add `CustomAttribute15` to it, step 3).
- Each venture: add `CustomAttribute15 LakebaPortal` to its `shareholders@` mailbox,
  then set the mailbox in Admin → Shareholder emails → Mailbox settings.
- To cut access at any time: remove the role assignments
  (`Get-ManagementRoleAssignment -RoleAssignee <client ID> | Remove-ManagementRoleAssignment`)
  or delete the certificate from the app.
