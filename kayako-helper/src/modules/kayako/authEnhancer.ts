// Auth Enhancer – propagate Kayako agent session across brands
// Runs in background (service worker) – imported by src/backgroundScript.ts

/*
  Behavior:
  - Watches the source domain session cookie (novo_sessionid) on central-supportdesk.kayako.com
  - When a fresh/updated cookie is detected, it propagates the cookie to every configured brand
  - Does not delete brand cookies on logout (when the cookie is removed); lets them expire naturally

  Notes:
  - For *.kayako.com hosts we set an explicit Domain attribute
  - For external hosts we set a host-only cookie (no Domain attribute)
  - Requires "cookies" permission and broad host permissions (already present in manifest)
*/

const MODULE_TAG = "[AUTH]";
const SOURCE_DOMAIN = "central-supportdesk.kayako.com";
const COOKIE_NAME = "novo_sessionid";

type Cookie = chrome.cookies.Cookie;

// Minimal promise wrappers for chrome.cookies APIs
function getAllCookies(filter: chrome.cookies.GetAllDetails): Promise<Cookie[]> {
	return new Promise(resolve => chrome.cookies.getAll(filter, resolve));
}

function removeCookie(url: string, name: string): Promise<void> {
	return new Promise(resolve => {
		chrome.cookies.remove({ url, name }, () => resolve());
	});
}

function setCookie(details: chrome.cookies.SetDetails): Promise<Cookie | undefined> {
	return new Promise(resolve => chrome.cookies.set(details, resolve));
}

function logInfo(message: string, extra?: unknown) {
	try {
		console.log(`%c${MODULE_TAG} ${message}`,'color:#06c;font-weight:600', extra ?? '');
	} catch {}
}

function logWarn(message: string, extra?: unknown) {
	try {
		console.warn(`%c${MODULE_TAG} ${message}`,'color:#b50;font-weight:600', extra ?? '');
	} catch {}
}

function logError(message: string, extra?: unknown) {
	try {
		console.error(`%c${MODULE_TAG} ${message}`,'color:#c00;font-weight:700', extra ?? '');
	} catch {}
}

function cookieDomainEquals(cookie: Cookie, host: string): boolean {
	return cookie.domain === host || cookie.domain === `.${host}`;
}

async function purgeOldCookies(host: string) {
	const stale = await getAllCookies({ domain: host, name: COOKIE_NAME });
	if (stale.length) logInfo(`Purging ${stale.length} old session cookie(s) on ${host}`);
	for (const c of stale) {
		const scheme = c.secure ? 'https' : 'http';
		const dom = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
		await removeCookie(`${scheme}://${dom}${c.path}`, COOKIE_NAME);
	}
}

async function setFreshCookie(host: string, template: Cookie) {
	const base: chrome.cookies.SetDetails = {
		url: `https://${host}/`,
		name: COOKIE_NAME,
		value: template.value,
		secure: template.secure ?? true,
		httpOnly: template.httpOnly,
		sameSite: template.sameSite,
		path: '/',
		expirationDate: template.expirationDate ?? Math.floor(Date.now() / 1000) + 86400,
	};

	if (host.endsWith('.kayako.com') && host !== SOURCE_DOMAIN) {
		await setCookie({ ...base, domain: host });
	} else {
		await setCookie(base);
	}
}

async function propagateCookie(template: Cookie) {
	const start = Date.now();
	let success = 0, failures = 0;
	logInfo(`Propagating agent session to ${BRANDS.length - 1} brand(s)`);
	for (const host of BRANDS) {
		if (host === SOURCE_DOMAIN) continue;
		try {
			await purgeOldCookies(host);
			await setFreshCookie(host, template);
			success++;
		} catch (e) {
			failures++;
			logWarn(`Failed to set cookie on ${host}`, e);
		}
	}
	logInfo(`Propagation completed in ${Date.now() - start} ms (ok=${success}, failed=${failures})`);
}

function isSourceCookie(cookie: Cookie): boolean {
	return cookie.name === COOKIE_NAME && cookieDomainEquals(cookie, SOURCE_DOMAIN);
}

// 1) Initial copy if session already exists
getAllCookies({ name: COOKIE_NAME }).then(cookies => {
	const src = cookies.find(isSourceCookie);
	if (src) {
		logInfo(`Source session detected at startup. Value length=${src.value?.length ?? 0}`);
		void propagateCookie(src);
	} else {
		logInfo('No source session cookie at startup');
	}
}).catch(err => logError('Startup probe failed', err));

// 2) Copy on every update to the source session
chrome.cookies.onChanged.addListener(changeInfo => {
	const { removed, cookie } = changeInfo;
	if (removed) return; // do not propagate deletions
	if (!cookie) return;
	if (!isSourceCookie(cookie)) return;
	logInfo('Source session updated – propagating');
	void propagateCookie(cookie);
});

// ------------------------------------------------------------
// Brands list (generated/maintained externally). Keep synchronized.
// ------------------------------------------------------------
const BRANDS: string[] = [
  "hand-support.kayako.com",
  "help.hand.com",
  "1-dayremoteu.kayako.com",
  "ic-remoteu.trilogy.com",
  "2hr-learning-support.kayako.com",
  "support.2hourlearning.com",
  "accuris-support.kayako.com",
  "acorn-supportdesk.kayako.com",
  "acquisition-integration.kayako.com",
  "acrm.kayako.com",
  "support.acrm.aurea.com",
  "actional-supportdesk.kayako.com",
  "support.actional.aurea.com",
  "lyris-hq-support.kayako.com",
  "lyris-lm-support.kayako.com",
  "aes-cis-support.kayako.com",
  "aes-edi-support.kayako.com",
  "agemni-supportdesk.kayako.com",
  "alp-support.kayako.com",
  "alpha-staff-campus-operation.kayako.com",
  "staff-support.alpha.school",
  "alpha-supportdesk.kayako.com",
  "ams-alertfind-support.kayako.com",
  "ams-ems-support.kayako.com",
  "answerhub-supportdesk.kayako.com",
  "answerhub.support.ignitetech.com",
  "support-apm.kayako.com",
  "support.apm.aurea.com",
  "atlas-success.kayako.com",
  "support-aem.kayako.com",
  "support.aem.aurea.com",
  "support-aes.kayako.com",
  "support.aes.aurea.com",
  "aurea-enterprise.kayako.com",
  "support-360002472480.kayako.com",
  "alss.support.ignitetech.com",
  "support-alss-jump.kayako.com",
  "support-ams.kayako.com",
  "support.ams.aurea.com",
  "support-aps.kayako.com",
  "support.aps.aurea.com",
  "aurea-rescue-line.kayako.com",
  "support-skyvera.kayako.com",
  "aureasocial.support.ignitetech.com",
  "support-aurea.kayako.com",
  "support.aurea.com",
  "auto-trol.kayako.com",
  "avolin-supportdesk.kayako.com",
  "beckon-supportdesk.kayako.com",
  "smsmasterminds-supportdesk.kayako.com",
  "biznessapps.kayako.com",
  "support-bonzai.kayako.com",
  "support.bonzai.aurea.com",
  "callstream-supportdesk.kayako.com",
  "support.callstream.com",
  "cardinalmark.kayako.com",
  "central-collections.kayako.com",
  "central-compliance.kayako.com",
  "central-finance.kayako.com",
  "central-saas.kayako.com",
  "central-supportdesk.kayako.com",
  "central-vendor-management.kayako.com",
  "centralhr.kayako.com",
  "citynumbers-supportdesk.kayako.com",
  "support.citynumbers.co.uk",
  "ccab-supportdesk.kayako.com",
  "support.ccab.totogi.com",
  "cloudcfo-supportdesk.kayako.com",
  "cloudfix.kayako.com",
  "support.cloudfix.com",
  "cloudsense.kayako.com",
  "supportportal.cloudsense.com",
  "communicate-xi-support.kayako.com",
  "support.guidespark.com",
  "computron-support.kayako.com",
  "contently-support.kayako.com",
  "support.contently.com",
  "coretrac.kayako.com",
  "crossoverhiring.kayako.com",
  "candidate-support.crossover.com",
  "crossover-internal.kayako.com",
  "crossover-supportdesk.kayako.com",
  "support.crossover.com",
  "cs-escalation.kayako.com",
  "cs-foundations.kayako.com",
  "cs-knowledge.kayako.com",
  "cs-managers-coaching.kayako.com",
  "csai.kayako.com",
  "csai.trilogy.com",
  "devflows.kayako.com",
  "devgraph.kayako.com",
  "devspaces.kayako.com",
  "discoverxi-supportdesk.kayako.com",
  "support.tivian.com",
  "dnn-centralsupport.kayako.com",
  "dnnsupport.dnnsoftware.com",
  "ecora-supportdesk.kayako.com",
  "alpha-school-support.kayako.com",
  "support.alpha.school",
  "edu-supportdesk.kayako.com",
  "edu-finops.kayako.com",
  "eloquens-ignitetech.kayako.com",
  "engineyardsupport.kayako.com",
  "support.engineyard.com",
  "trilogy5k.kayako.com",
  "engineering-remote-university.kayako.com",
  "ephor-support.kayako.com",
  "support.ephor.ai",
  "epm-live-ignitetech.kayako.com",
  "escalations-team.kayako.com",
  "everest.kayako.com",
  "gfi-exinda-supportdesk.kayako.com",
  "support.exinda.gfi.com",
  "field-forcemanager-supportdesk.kayako.com",
  "support.fieldforcemanager.com",
  "fionn-renewals.kayako.com",
  "firm58-support.kayako.com",
  "support-firstrain.kayako.com",
  "support-firstrain-jump.kayako.com",
  "fogbugz-legacy-redirection.kayako.com",
  "fogbugz.kayako.com",
  "support.fogbugz.com",
  "gensym-ignitetech.kayako.com",
  "gfi-accountsportal-supportdesk.kayako.com",
  "support.accounts.gfi.com",
  "gfi-appmanager-supportdesk.kayako.com",
  "support.appmanager.gfi.com",
  "gfi-archiver-supportdesk.kayako.com",
  "support.archiver.gfi.com",
  "gfi-clearview-supportdesk.kayako.com",
  "gfi-endpointsecurity-supportdesk.kayako.com",
  "support.endpointsecurity.gfi.com",
  "gfi-eventsmanager-supportdesk.kayako.com",
  "support.eventsmanager.gfi.com",
  "gfi-faxmaker-supportdesk.kayako.com",
  "support.faxmaker.gfi.com",
  "gfi-faxmakeronline-supportdesk.kayako.com",
  "support.faxmakeronline.gfi.com",
  "gfi-languard-supportdesk.kayako.com",
  "support.languard.gfi.com",
  "gfi-mailessentials-supportdesk.kayako.com",
  "support.mailessentials.gfi.com",
  "gfi-supportdesk.kayako.com",
  "support.gfi.com",
  "gfi-webmonitor-supportdesk.kayako.com",
  "gomembers-4gov.kayako.com",
  "gomembers-enterprise.kayako.com",
  "gomembers-ondemand.kayako.com",
  "suuchi-grid-support.kayako.com",
  "support-grid.ignitetech.com",
  "ignite-supportdesk.kayako.com",
  "support.ignitetech.com",
  "infer-ignitetech.kayako.com",
  "influitive-supportdesk.kayako.com",
  "support.influitive.com",
  "infobright-ignitetech.kayako.com",
  "inmoment-support.kayako.com",
  "internal-test-centralsupport.kayako.com",
  "invigorate-support.kayako.com",
  "jigsawme-supportdesk.kayako.com",
  "support.jigsawinteractive.com",
  "aureajive.kayako.com",
  "support.jivesoftware.com",
  "jive-support-jump.kayako.com",
  "kandy-ucaas-support.kayako.com",
  "supportportal.kandy.io",
  "kayakoclassic.kayako.com",
  "classichelp.kayako.com",
  "kayako-supportdesk.kayako.com",
  "help.kayako.com",
  "support-360002231414.kayako.com",
  "gfi-kerioconnect-supportdesk.kayako.com",
  "support.kerioconnect.gfi.com",
  "gfi-keriocontrol-supportdesk.kayako.com",
  "support.keriocontrol.gfi.com",
  "gfi-keriooperator-supportdesk.kayako.com",
  "support.keriooperator.gfi.com",
  "khoros-support.kayako.com",
  "supportportal.khoros.com",
  "khoros-aurora.kayako.com",
  "khoros-care.kayako.com",
  "khoros-classic.kayako.com",
  "khoros-flow.kayako.com",
  "khoros-marketing.kayako.com",
  "knova.kayako.com",
  "learnandearn-supportdesk.kayako.com",
  "support.learnandearn.school",
  "cs-learning.kayako.com",
  "ma-internal.kayako.com",
  "mobileappco.kayako.com",
  "mobilogynow-support.kayako.com",
  "myalerts-supportdesk.kayako.com",
  "gfi-mykerio-supportdesk.kayako.com",
  "mypersonas-ignitetech.kayako.com",
  "newnet-support.kayako.com",
  "support-360002235594.kayako.com",
  "support.northplains.com",
  "telescope-supportdesk.kayako.com",
  "xinet.kayako.com",
  "xinet.support.northplains.com",
  "ns8protect.kayako.com",
  "nuview-ignitetech.kayako.com",
  "objectstore-ignitetech.kayako.com",
  "olive-ignitetech.kayako.com",
  "onescm-supportdesk.kayako.com",
  "support.onescm.com",
  "onyx-supportdesk.kayako.com",
  "support.onyx.aurea.com",
  "pivotal-supportdesk.kayako.com",
  "support.pivotal.aurea.com",
  "placeable-supportdesk.kayako.com",
  "support.placeable.com",
  "playbooks-supportdesk.kayako.com",
  "support.playbooks.aurea.com",
  "post-beyond.kayako.com",
  "cpq-brms.kayako.com",
  "prologic.kayako.com",
  "prysm-supportdesk.kayako.com",
  "support-quicksilver.kayako.com",
  "support.qs.aurea.com",
  "central-bootcamp.kayako.com",
  "responsetek-support.kayako.com",
  "routingbrand.kayako.com",
  "saas-backlog.kayako.com",
  "support-sb.kayako.com",
  "salesbuilder.kayako.com",
  "salesbuilder.support.ignitetech.com",
  "saratoga-supportdesk.kayako.com",
  "support.saratoga.aurea.com",
  "savvion-supportdesk.kayako.com",
  "support.savvion.aurea.com",
  "scalearc-devgraph.kayako.com",
  "scalearc.support.ignitetech.com",
  "schoolloop-supportdesk.kayako.com",
  "securityfirst-supportdesk.kayako.com",
  "servicegateway-support.kayako.com",
  "skyvera-analytics.kayako.com",
  "skyvera-monetization.kayako.com",
  "skyvera-network.kayako.com",
  "skyvera-helpdesk.kayako.com",
  "support.skyvera.com",
  "smartroutines.kayako.com",
  "smsmasterminds.kayako.com",
  "redirect-sms-masterminds.kayako.com",
  "sococo-supportdesk.kayako.com",
  "support.sococo.com",
  "sococo5k.kayako.com",
  "sonic-supportdesk.kayako.com",
  "support.sonic.aurea.com",
  "star.kayako.com",
  "stratifyd-supportdesk.kayako.com",
  "streetsmart-supportdesk.kayako.com",
  "support.streetsmartmobile.com",
  "supportsoft.kayako.com",
  "symphonycommerce-support.kayako.com",
  "support-synoptos-jump.kayako.com",
  "tempo-support.kayako.com",
  "tempo-assembly-lines.kayako.com",
  "totogi-supportdesk.kayako.com",
  "support.totogi.com",
  "tracking-supportdesk.kayako.com",
  "tradebeam.kayako.com",
  "vasona-support.kayako.com",
  "verdiem.kayako.com",
  "versata-centralsupport.kayako.com",
  "vision-supportdesk.kayako.com",
  "voltdelta-support.kayako.com",
];


