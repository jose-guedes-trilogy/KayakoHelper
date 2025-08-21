// background.ts
import { installHarProxy } from "./requestProxy";     // you already have this
import { installAwsAuthBridge } from "./awsAuth";     // NEW
import { installCredProbeRunner } from "./credProbeRunner";

installHarProxy();
installAwsAuthBridge();
installCredProbeRunner();
