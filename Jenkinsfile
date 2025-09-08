pipeline {
  agent any

  options {
    timestamps()
    ansiColor('xterm')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  parameters {
    string(name: 'AWS_REGION', defaultValue: 'us-east-1', description: 'AWS region')
    string(name: 'EKS_CLUSTER', defaultValue: 'rmit-eks', description: 'EKS cluster name')
    string(name: 'K8S_NAMESPACE', defaultValue: 'web', description: 'Kubernetes namespace')
    string(name: 'BACKEND_REPO', defaultValue: 'rmit-store/backend', description: 'Backend repository')
    string(name: 'FRONTEND_REPO', defaultValue: 'rmit-store/frontend', description: 'Frontend repository')
    booleanParam(name: 'APPLY_MANIFESTS', defaultValue: false, description: 'Apply k8s/<namespace>/ manifests (first deploy)')
    booleanParam(name: 'SEED_DB', defaultValue: false, description: 'Run seed job after deploy')
    booleanParam(name: 'PROMOTE', defaultValue: true, description: 'After tests pass, promote new color (blue-green flip)')
    booleanParam(name: 'KEEP_OLD_COLOR', defaultValue: false, description: 'If true, do not scale old color to 0')
  }

  environment {
    REGION = "${params.AWS_REGION}"
    CLUSTER = "${params.EKS_CLUSTER}"
    NAMESPACE = "${params.K8S_NAMESPACE}"
    BACKEND_REPO = "${params.BACKEND_REPO}"
    FRONTEND_REPO = "${params.FRONTEND_REPO}"
    NPM_CONFIG_CACHE = "${JENKINS_HOME}/.npm-cache"
    PLAYWRIGHT_BROWSERS_PATH = "${JENKINS_HOME}/.cache/ms-playwright"
    DOCKER_BUILDKIT = "1"
  }

  stages {
    stage('Resolve IDs & Login to ECR') {
      steps {
        script {
          env.ACCOUNT_ID = sh(script: "aws sts get-caller-identity --query Account --output text", returnStdout: true).trim()
          env.ECR = "${env.ACCOUNT_ID}.dkr.ecr.${env.REGION}.amazonaws.com"
          env.GIT_SHA = sh(script: "git rev-parse --short=12 HEAD", returnStdout: true).trim()
          env.IMG_TAG = "${env.GIT_SHA}-${env.BUILD_NUMBER}"
          env.BACKEND_IMAGE = "${env.ECR}/rmit-store/backend:${env.IMG_TAG}"
          env.FRONTEND_IMAGE = "${env.ECR}/rmit-store/frontend:${env.IMG_TAG}"
        }
        sh 'aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"'
      }
    }

    stage('Ensure ECR repositories') {
      steps {
        sh '''
          set -euo pipefail

          ensure_repo () {
            local repo="$1"
            if aws ecr describe-repositories --region "$REGION" --repository-names "$repo" >/dev/null 2>&1; then
              echo "ECR repo $repo already exists"
            else
              echo "Creating ECR repo: $repo"
              aws ecr create-repository --region "$REGION" --repository-name "$repo" --image-scanning-configurations canOnPush=true --encryption-configuration encryptionType=AES256

              # Optional: keep only the last 10 images (best-effort; ignore if denied)
              aws ecr put-lifecycle-policy --region "$REGION" --repository-name "$repo" --lifecycle-policy-text '{
                "rules": [
                  {
                    "rulePriority": 1,
                    "description": "Keep last 10 images",
                    "selection": { "tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 10 },
                    "action": { "type": "expire" }
                  }
                ]
              }' || true
            fi
          }

          ensure_repo "$BACKEND_REPO"
          ensure_repo "$FRONTEND_REPO"
        '''
      }
    }

    stage('Build backend image') {
      steps { sh 'docker build -f server/Dockerfile -t "$BACKEND_IMAGE" .' }
    }

    stage('Build frontend image') {
      steps { sh 'docker build -f client/Dockerfile -t "$FRONTEND_IMAGE" .' }
    }

    stage('Push images') {
      steps {
        sh '''
          docker push "$BACKEND_IMAGE"
          docker push "$FRONTEND_IMAGE"
        '''
      }
    }

    stage('Kube context') {
      steps { sh 'aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER"' }
    }

    stage('Apply k8s manifests (first time only)') {
      when { expression { return params.APPLY_MANIFESTS } }
      steps { sh 'kubectl -n "$NAMESPACE" apply -f "k8s/$NAMESPACE"' }
    }

    stage('Blue-Green: plan color') {
      steps {
        script {
          def live = sh(script: 'kubectl -n "$NAMESPACE" get svc frontend-svc -o jsonpath="{.spec.selector.version}" || echo blue', returnStdout: true).trim()
          env.LIVE_COLOR = live ?: "blue"
          env.NEW_COLOR  = (env.LIVE_COLOR == "blue") ? "green" : "blue"
          echo "LIVE_COLOR=${env.LIVE_COLOR}; NEW_COLOR=${env.NEW_COLOR}"
        }
      }
    }

    stage('Blue-Green: deploy NEW color (no traffic)') {
      steps {
        sh '''
          set -euo pipefail
          cat <<YAML | kubectl -n "$NAMESPACE" apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-${NEW_COLOR}
  namespace: ${NAMESPACE}
  labels: { app: backend, version: ${NEW_COLOR} }
spec:
  replicas: 1
  selector: { matchLabels: { app: backend, version: ${NEW_COLOR} } }
  template:
    metadata:
      labels: { app: backend, version: ${NEW_COLOR} }
    spec:
      containers:
      - name: backend
        image: ${BACKEND_IMAGE}
        ports:
        - containerPort: 3000
        env:
        - name: PORT
          value: "3000"
        - name: BASE_API_URL
          value: "api"
        - name: MONGO_URI
          valueFrom: { secretKeyRef: { name: app-secrets, key: MONGO_URI } }
        - name: CLIENT_URL
          valueFrom: { configMapKeyRef: { name: app-config, key: CLIENT_URL } }
---
apiVersion: v1
kind: Service
metadata:
  name: backend-svc-${NEW_COLOR}
  namespace: ${NAMESPACE}
  labels: { app: backend }
spec:
  type: ClusterIP
  selector: { app: backend, version: ${NEW_COLOR} }
  ports:
  - port: 3000
    targetPort: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-${NEW_COLOR}
  namespace: ${NAMESPACE}
  labels: { app: frontend, version: ${NEW_COLOR} }
spec:
  replicas: 1
  selector: { matchLabels: { app: frontend, version: ${NEW_COLOR} } }
  template:
    metadata:
      labels: { app: frontend, version: ${NEW_COLOR} }
    spec:
      containers:
      - name: frontend
        image: ${FRONTEND_IMAGE}
        ports:
        - containerPort: 8080
        env:
        - name: API_URL
          valueFrom: { configMapKeyRef: { name: app-config, key: API_URL } }
        - name: HOST
          value: "0.0.0.0"
        - name: PORT
          value: "8080"
---
apiVersion: v1
kind: Service
metadata:
  name: frontend-svc-${NEW_COLOR}
  namespace: ${NAMESPACE}
  labels: { app: frontend }
spec:
  type: ClusterIP
  selector: { app: frontend, version: ${NEW_COLOR} }
  ports:
  - port: 8080
    targetPort: 8080
YAML

          kubectl -n "$NAMESPACE" rollout status deploy/backend-${NEW_COLOR}  --timeout=180s
          kubectl -n "$NAMESPACE" rollout status deploy/frontend-${NEW_COLOR} --timeout=180s
        '''
      }
    }

    stage('Blue-Green: create temp test ingress for NEW color') {
        steps {
          sh '''
            set -euo pipefail
            # FRONTEND temp ingress: /_<color>/(...) -> /$1 -> frontend-svc-<color>
            cat <<'YAML' | envsubst | kubectl -n "$NAMESPACE" apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress-${NEW_COLOR}-fe-test
  namespace: ${NAMESPACE}
  annotations:
    nginx.ingress.kubernetes.io/use-regex: "true"
    nginx.ingress.kubernetes.io/rewrite-target: /\\$1
spec:
  ingressClassName: nginx
  rules:
  - http:
      paths:
      - path: /_${NEW_COLOR}/(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: frontend-svc-${NEW_COLOR}
            port:
              number: 8080
YAML

            # API temp ingress: /_<color>/api/(...) -> /api/$1 -> backend-svc-<color>
            cat <<'YAML' | envsubst | kubectl -n "$NAMESPACE" apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress-${NEW_COLOR}-api-test
  namespace: ${NAMESPACE}
  annotations:
    nginx.ingress.kubernetes.io/use-regex: "true"
    nginx.ingress.kubernetes.io/rewrite-target: /api/\\$1
spec:
  ingressClassName: nginx
  rules:
  - http:
      paths:
      - path: /_${NEW_COLOR}/api/(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: backend-svc-${NEW_COLOR}
            port:
              number: 3000
YAML
          '''
      }
    }

    stage('Backend: Unit + Integration tests') {
      steps {
        sh '''
          set -euo pipefail

          NET="ci-net-$BUILD_TAG"
          docker network create "$NET" >/dev/null 2>&1 || true

          cleanup() {
            docker rm -f mongo-test >/dev/null 2>&1 || true
            docker network rm "$NET" >/dev/null 2>&1 || true
          }
          trap cleanup EXIT

          echo "Running backend tests inside Node container..."
          docker run --rm --network "$NET" --init \
            -u $(id -u):$(id -g) \
            -e HOME=/work \
            -e NPM_CONFIG_CACHE=/work/.npm-cache \
            -e NODE_ENV=test \
            -e MONGO_URI="${MONGO_URI:-}" \
            -v "$PWD/server":/work -w /work \
            node:22-bullseye bash -lc '
              set -euo pipefail
              mkdir -p .npm-cache
              npm ci --no-audit --no-fund
              npm run test
            '
        '''
      }
      post { always { junit allowEmptyResults: true, testResults: 'server/junit.xml' } }
    }

    stage('Seed database (from file)') {
      when { expression { return params.SEED_DB } }
      steps {
        withCredentials([usernamePassword(credentialsId: 'seed-admin',
                                          usernameVariable: 'SEED_ADMIN_EMAIL',
                                          passwordVariable: 'SEED_ADMIN_PASSWORD')]) {
          sh '''
            set -euo pipefail

            # Clean previous run (if any)
            kubectl -n "$NAMESPACE" delete job/seed-db --ignore-not-found=true

            # Create/refresh a temporary Secret with admin creds
            kubectl -n "$NAMESPACE" create secret generic seed-admin \
              --from-literal=email="$SEED_ADMIN_EMAIL" \
              --from-literal=password="$SEED_ADMIN_PASSWORD" \
              --dry-run=client -o yaml | kubectl apply -f -

            # Substitute image into the checked-in Job file and apply it
            sed "s|__IMAGE__|$BACKEND_IMAGE|g" k8s/99-seed-db.yaml | kubectl -n "$NAMESPACE" apply -f -

            kubectl -n "$NAMESPACE" wait --for=condition=complete job/seed-db --timeout=180s || true
            kubectl -n "$NAMESPACE" delete secret seed-admin --ignore-not-found=true
          '''
        }
      }
    }

    stage('Set E2E_BASE_URL') {
      steps {
        script {
          def ep = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'", returnStdout: true).trim()
          if (!ep) {
            ep = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'", returnStdout: true).trim()
          }
          env.E2E_BASE_URL = "http://${ep}:8080/_${env.NEW_COLOR}/"
          echo "E2E_BASE_URL=${env.E2E_BASE_URL}"
        }
      }
    }

    stage('Web UI E2E (Playwright) against NEW color') {
      steps {
        sh '''
          set -euo pipefail
          docker pull mcr.microsoft.com/playwright:v1.55.0-jammy
          docker run --rm \
            --shm-size=1g \
            -u $(id -u):$(id -g) \
            -e HOME=/work \
            -e NPM_CONFIG_CACHE=/work/.npm-cache \
            -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
            -e E2E_BASE_URL="${E2E_BASE_URL}" \
            -v "$PWD":/work -w /work \
            mcr.microsoft.com/playwright:v1.55.0-jammy \
            bash -lc '
              mkdir -p .npm-cache
              npm ci --no-audit --no-fund
              # Browsers are already baked into the image via /ms-playwright
              npx playwright test --reporter=html
            '
        '''
      }
      post { always { archiveArtifacts artifacts: 'playwright-report/**', fingerprint: true } }
    }

    stage('Blue-Green: remove temp test ingress') {
      steps { sh 'kubectl -n "$NAMESPACE" delete ingress app-ingress-${NEW_COLOR}-test --ignore-not-found=true' }
    }

    stage('Blue-Green: switch traffic to NEW color') {
      when { expression { return params.PROMOTE } }
      steps {
        sh '''
          set -euo pipefail
          kubectl -n "$NAMESPACE" patch svc backend-svc -p '{"spec":{"selector":{"app":"backend","version":"'"${NEW_COLOR}"'"}}}'
          kubectl -n "$NAMESPACE" patch svc frontend-svc -p '{"spec":{"selector":{"app":"frontend","version":"'"${NEW_COLOR}"'"}}}'
        '''
      }
    }

    stage('Normalize API_URL after switch') {
      steps {
        sh '''
          set -euo pipefail
          kubectl -n "$NAMESPACE" set env deploy/frontend-${NEW_COLOR} API_URL="/api"
          kubectl -n "$NAMESPACE" rollout status deploy/frontend-${NEW_COLOR} --timeout=180s
        '''
      }
    }

    stage('Prod verify via Ingress') {
      when { expression { return params.PROMOTE } }
      steps {
        sh '''
          set -euo pipefail
          EP=""
          for i in $(seq 1 30); do
            EP=$(kubectl -n ingress-nginx get svc ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'); \
            [ -z "$EP" ] && EP=$(kubectl -n ingress-nginx get svc ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}'); \
            [ -n "$EP" ] && break; sleep 5; done
          [ -z "$EP" ] && { echo "No ingress endpoint"; exit 1; }

          curl -fsS --max-time 15 "http://$EP:8080/" >/dev/null
          curl -fsS --max-time 15 "http://$EP:8080/shop" >/dev/null
          echo "Production is serving ${NEW_COLOR}"
        '''
      }
    }

    stage('Blue-Green: tidy old color') {
      when { expression { return !params.KEEP_OLD_COLOR } }
      steps {
        sh '''
          set -euo pipefail
          kubectl -n "$NAMESPACE" scale deploy/backend-${LIVE_COLOR}  --replicas=0 || true
          kubectl -n "$NAMESPACE" scale deploy/frontend-${LIVE_COLOR} --replicas=0 || true
        '''
      }
    }

    stage('Cleanup test ingress') {
      steps {
        sh '''
          kubectl -n "$NAMESPACE" delete ingress app-ingress-${NEW_COLOR}-fe-test  --ignore-not-found=true
          kubectl -n "$NAMESPACE" delete ingress app-ingress-${NEW_COLOR}-api-test --ignore-not-found=true
        '''
      }
    }

    stage('Show endpoints') {
      steps { echo "You can test the website in: ${E2E_BASE_URL}" }
    }

    stage('Promote to Prod') {
      when { expression { currentBuild.currentResult == 'SUCCESS' } }
      steps { echo 'All tests passed. Deploying to production...' }
    }
  }

  post {
    failure {
      echo "Deployment failed - attempting rollback"
      sh '''
        kubectl -n "$NAMESPACE" rollout undo deploy/backend || true
        kubectl -n "$NAMESPACE" rollout undo deploy/frontend || true
        kubectl -n "$NAMESPACE" get deploy -o wide || true
        kubectl -n "$NAMESPACE" patch svc backend-svc -p '{"spec":{"selector":{"app":"backend","version":"'"${LIVE_COLOR}"'"}}}' || true
        kubectl -n "$NAMESPACE" patch svc frontend-svc -p '{"spec":{"selector":{"app":"frontend","version":"'"${LIVE_COLOR}"'"}}}' || true
      '''
      emailext(
        subject: "❌ FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
        to: '$DEFAULT_RECIPIENTS',
        body: """
          <h2>Build Failed</h2>
          <p><b>Job:</b> ${env.JOB_NAME}<br/>
            <b>Build #:</b> ${env.BUILD_NUMBER}<br/>
            <b>Status:</b> ${currentBuild.currentResult}<br/>
            <b>Branch:</b> ${env.BRANCH_NAME ?: 'main'}</p>
          <p><a href="${env.BUILD_URL}">Open build</a></p>
        """
      )
    }
    always {
      archiveArtifacts artifacts: '**/Dockerfile, k8s/**/*.yaml', fingerprint: true, onlyIfSuccessful: false
    }
    success {
      echo "✅ Deployed images:"
      echo "   $BACKEND_IMAGE"
      echo "   $FRONTEND_IMAGE"
    }
  }
}
