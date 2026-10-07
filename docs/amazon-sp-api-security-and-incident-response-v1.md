# Sunshine Amazon SP-API Security and Incident Response V1

Owner: SUNSHINE ECOMMERCE, LLC  
System: IMNOVA Seller OS private Amazon integration  
Data scope: non-restricted seller listing, inventory, price, sales/traffic, and finance data. Buyer PII is not requested or stored.

## Access and credential controls

- Amazon data is available only through authenticated Seller OS administrative routes and database row-level security.
- Access is granted by business function and limited to authorized Sunshine personnel or contractors.
- SP-API credentials are stored only as encrypted server-side deployment secrets. They are not committed to source control, exposed to browsers, or included in logs.
- Data is encrypted in transit with HTTPS/TLS. Production application traffic and storage use the managed security boundaries of Vercel and Supabase.
- The integration is read-only. It does not publish listings, change prices, fulfill orders, or modify Amazon account data.

## Service providers and data sharing

- Vercel hosts the server-side application runtime.
- Supabase hosts the application database and enforces row-level access controls.
- Authorized Sunshine personnel or contractors may view bounded operational results through Seller OS or their separately authorized Seller Central access.
- Amazon information is not sold, used for advertising, or shared with suppliers. Supplier cost information is independent input and is not an external source of Amazon information.

## Incident response

The Sunshine account owner is the incident commander. The technical operator supports investigation, containment, credential rotation, evidence preservation, and recovery.

For any suspected exposure, misuse, or loss of Amazon information:

1. Contain access immediately and disable the affected integration or credential.
2. Preserve relevant deployment, authentication, database, and application audit evidence.
3. Determine the affected data, users, systems, and time window.
4. Rotate affected credentials and remediate the root cause before restoring access.
5. Notify `security@amazon.com` within 24 hours of detecting an incident involving Amazon information, including known scope and containment status.
6. Record the incident, corrective actions, and follow-up owner.

This plan must be reviewed at least every six months and after every material incident or architecture change.

## Account security policy

- Administrative accounts must use multifactor authentication where the provider supports it.
- Passwords must contain at least 12 characters and a special character, must not be shared, and must be changed at least annually or immediately after suspected compromise.
- Access must be removed when no longer required and reviewed at least every six months.

