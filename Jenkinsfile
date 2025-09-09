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
    string(name: 'DEV_NAMESPACE', defaultValue: 'web', description: 'Kubernetes namespace (dev)')
    string(name: 'PROD_NAMESPACE', defaultValue: 'prod', description: 'Kubernetes namespace (prod)')
    string(name: 'BACKEND_REPO', defaultValue: 'rmit-store/backend', description: 'ECR repo path for backend')
    string(name: 'FRONTEND_REPO', defaultValue: 'rmit-store/frontend', description: 'ECR repo path for frontend')
    booleanParam(name: 'APPLY_MANIFESTS', defaultValue: true, description: 'Apply k8s/<DEV_NAMESPACE> manifests (first time only)')
    booleanParam(name: 'APPLY_PROD_MANIFESTS', defaultValue: true, description: 'Apply k8s/<PROD_NAMESPACE> manifests (first time only)')
    booleanParam(name: 'SEED_DB', defaultValue: true, description: 'Run seed job on DEV after deploy')
    string(name: 'CANARY_WEIGHT', defaultValue: '10', description: 'Initial canary traffic percentage (0-100)')
    // Optional overrides; if left as "auto", the pipeline discovers them from the ingress LB
    string(name: 'DEV_HOSTNAME',  defaultValue: 'auto', description: 'Dev hostname (auto -> dev.<lb-host>.nip.io)')
    string(name: 'PROD_HOSTNAME', defaultValue: 'auto', description: 'Prod hostname (auto -> prod.<lb-host>.nip.io)')
  }

  environment {
    REGION = "${params.AWS_REGION}"
    CLUSTER = "${params.EKS_CLUSTER}"
    DEV_NS = "${params.DEV_NAMESPACE}"
    PROD_NS = "${params.PROD_NAMESPACE}"
    BACKEND_REPO = "${params.BACKEND_REPO}"
    FRONTEND_REPO = "${params.FRONTEND_REPO}"
    CANARY_WEIGHT = "${params.CANARY_WEIGHT}"

    NPM_CONFIG_CACHE = "${JENKINS_HOME}/.npm-cache"
    PLAYWRIGHT_BROWSERS_PATH = "${JENKINS_HOME}/.cache/ms-playwright"
    DOCKER_BUILDKIT = "1"
  }

  stages {
    /* 1) Build & push images (ECR) */
    stage('Resolve IDs & Login to ECR') {
      steps {
        script {
          env.ACCOUNT_ID = sh(script: "aws sts get-caller-identity --query Account --output text", returnStdout: true).trim()
          env.ECR = "${env.ACCOUNT_ID}.dkr.ecr.${env.REGION}.amazonaws.com"
          env.GIT_SHA = sh(script: "git rev-parse --short=12 HEAD", returnStdout: true).trim()
          env.IMG_TAG = "${env.GIT_SHA}-${env.BUILD_NUMBER}"
          env.BACKEND_IMAGE = "${env.ECR}/${env.BACKEND_REPO}:${env.IMG_TAG}"
          env.FRONTEND_IMAGE = "${env.ECR}/${env.FRONTEND_REPO}:${env.IMG_TAG}"
        }
        sh 'aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"'
      }
    }

    stage('Ensure ECR repositories') {
      steps {
        sh '''
          set -euo pipefail
          for repo in "$BACKEND_REPO" "$FRONTEND_REPO"; do
            if aws ecr describe-repositories --region "$REGION" --repository-names "$repo" >/dev/null 2>&1; then
              echo "ECR repo $repo exists"
            else
              echo "Creating ECR repo: $repo"
              aws ecr create-repository --region "$REGION" --repository-name "$repo" --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 >/dev/null
              # best-effort lifecycle
              aws ecr put-lifecycle-policy --region "$REGION" --repository-name "$repo" --lifecycle-policy-text '{
                "rules": [{
                  "rulePriority": 1,
                  "description": "Keep last 10 images",
                  "selection": {"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},
                  "action": {"type":"expire"}
                }]
              }' || true
            fi
          done
        '''
      }
    }

    stage('Build & Push Images') {
      steps {
        sh '''
          set -euo pipefail
          echo ":: Building backend :: "
          docker build -t "$BACKEND_IMAGE" -f server/Dockerfile .
          docker push "$BACKEND_IMAGE"

          echo ":: Building frontend :: "
          docker build -t "$FRONTEND_IMAGE" -f client/Dockerfile .
          docker push "$FRONTEND_IMAGE"
        '''
      }
    }

    /* 2) Deploy to DEV and test */
    stage('Configure kubectl') {
      steps { sh 'aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER"' }
    }

    stage('Apply k8s manifests (DEV, first time only)') {
      when { expression { return params.APPLY_MANIFESTS } }
      steps { sh 'kubectl -n "$DEV_NS" apply -f "k8s/$DEV_NS"' }
    }

    stage('Deploy to DEV') {
      steps {
        sh '''
          kubectl -n "$DEV_NS" set image deploy/backend  backend="$BACKEND_IMAGE"
          kubectl -n "$DEV_NS" set image deploy/frontend frontend="$FRONTEND_IMAGE"
          kubectl -n "$DEV_NS" rollout status deploy/backend  --timeout=180s
          kubectl -n "$DEV_NS" rollout status deploy/frontend --timeout=180s
        '''
      }
    }

    stage('Discover Ingress & URLs') {
      steps {
        script {
          def lbHost = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'", returnStdout: true).trim()
          if (!lbHost) {
            lbHost = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'", returnStdout: true).trim()
          }
          env.INGRESS_LB_HOST = lbHost
          env.INGRESS_LB_IP   = sh(script: "getent hosts ${lbHost} | awk '{print \$1}' | head -n1 || dig +short ${lbHost} | head -n1", returnStdout: true).trim()

          def devHost  = params.DEV_HOSTNAME  == 'auto' ? "dev.${lbHost}.nip.io"  : params.DEV_HOSTNAME
          def prodHost = params.PROD_HOSTNAME == 'auto' ? "prod.${lbHost}.nip.io" : params.PROD_HOSTNAME
          env.DEV_HOST  = devHost
          env.PROD_HOST = prodHost

          env.E2E_BASE_URL  = "http://${devHost}:8080"
          env.PROD_BASE_URL = "http://${prodHost}:8080"

          echo "LB Host: ${env.INGRESS_LB_HOST}, LB IP: ${env.INGRESS_LB_IP}"
          echo "DEV:  ${env.E2E_BASE_URL}"
          echo "PROD: ${env.PROD_BASE_URL}"
        }
      }
    }

    stage('Seed database (DEV)') {
      when { expression { return params.SEED_DB } }
      steps {
        withCredentials([usernamePassword(credentialsId: 'seed-admin',
                                          usernameVariable: 'SEED_ADMIN_EMAIL',
                                          passwordVariable: 'SEED_ADMIN_PASSWORD')]) {
          sh '''
            set -euo pipefail
            kubectl -n "$DEV_NS" delete job/seed-db --ignore-not-found=true
            kubectl -n "$DEV_NS" create secret generic seed-admin \
              --from-literal=email="$SEED_ADMIN_EMAIL" \
              --from-literal=password="$SEED_ADMIN_PASSWORD" \
              --dry-run=client -o yaml | kubectl apply -f -
            sed "s|__IMAGE__|$BACKEND_IMAGE|g" k8s/99-seed-db.yaml | kubectl -n "$DEV_NS" apply -f -
            kubectl -n "$DEV_NS" wait --for=condition=complete job/seed-db --timeout=120s || true
            kubectl -n "$DEV_NS" delete secret seed-admin --ignore-not-found=true
          '''
        }
      }
    }

    stage('Wait DEV readiness') {
      steps {
        sh '''
          set -euo pipefail
          echo "Warming up DEV endpoints: $E2E_BASE_URL ..."

          # Frontend readiness via --resolve (bypass DNS)
          for i in $(seq 1 18); do
            if curl --resolve "${DEV_HOST}:8080:${INGRESS_LB_IP}" -fsSI "${E2E_BASE_URL}/" >/dev/null 2>&1; then
              echo "Frontend is responding."
              break
            fi
            echo "Waiting for frontend... ($i/18)"
            sleep 5
          done

          # Backend readiness via --resolve (bypass DNS)
          for i in $(seq 1 18); do
            if curl --resolve "${DEV_HOST}:8080:${INGRESS_LB_IP}" -fsS "${E2E_BASE_URL}/api/brand/list" >/dev/null 2>&1; then
              echo "Backend API is responding."
              break
            fi
            echo "Waiting for backend API... ($i/18)"
            sleep 5
          done
        '''
      }
    }

    stage('Web UI E2E (Playwright, DEV)') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'seed-admin',
                                        usernameVariable: 'SEED_ADMIN_EMAIL',
                                        passwordVariable: 'SEED_ADMIN_PASSWORD')]) {
          sh '''
            set -euo pipefail
            docker pull mcr.microsoft.com/playwright:v1.55.0-jammy

            echo "----- FRONTEND HEADERS -----"
            curl --resolve "${DEV_HOST}:8080:${INGRESS_LB_IP}" -i "${E2E_BASE_URL}/" | head -n 20 || true

            echo "----- SAMPLE API CALL -----"
            curl --resolve "${DEV_HOST}:8080:${INGRESS_LB_IP}" -sS "${E2E_BASE_URL}/api/brand/list" | head -c 400 || true
            echo

            docker run --rm --shm-size=1g -u $(id -u):$(id -g) \
              --add-host ${DEV_HOST}:${INGRESS_LB_IP} \
              -e HOME=/work -e NPM_CONFIG_CACHE=/work/.npm-cache \
              -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
              -e E2E_BASE_URL="${E2E_BASE_URL}" \
              -e E2E_EMAIL="${SEED_ADMIN_EMAIL}" \
              -e E2E_PASSWORD="${SEED_ADMIN_PASSWORD}" \
              -v "$PWD":/work -w /work \
              mcr.microsoft.com/playwright:v1.55.0-jammy \
              bash -lc '
                set -euo pipefail
                mkdir -p .npm-cache
                npm ci --no-audit --no-fund
                # Give tests more time and collect trace on first retry
                npx playwright test --reporter=html --timeout=90000 --retries=1 --trace on-first-retry
              '
          '''
        }
      }
      post { always { archiveArtifacts artifacts: 'playwright-report/**', fingerprint: true } }
    }

    stage('Show DEV endpoint') { steps { echo "Visit: ${E2E_BASE_URL}" } }

    /* 3) Promote to PROD with canary */
    stage('Init Prod Manifests (first time only)') {
      when { expression { return params.APPLY_PROD_MANIFESTS } }
      steps {
        sh '''
          set -euo pipefail
          kubectl apply -f k8s/prod/00-namespace.yaml
          kubectl -n "$PROD_NS" apply -f k8s/prod/10-configmap.yaml
          kubectl -n "$PROD_NS" apply -f k8s/prod/11-secret.yaml
          kubectl -n "$PROD_NS" apply -f k8s/prod/20-backend-deploy.yaml
          kubectl -n "$PROD_NS" apply -f k8s/prod/21-backend-svc.yaml
          kubectl -n "$PROD_NS" apply -f k8s/prod/30-frontend-deploy.yaml
          kubectl -n "$PROD_NS" apply -f k8s/prod/31-frontend-svc.yaml
        '''
      }
    }

    stage('Apply Prod Ingress (base)') {
      steps {
        sh '''
          set -euo pipefail
          sed "s|__PROD_HOST__|$PROD_HOST|g" k8s/prod/40-ingress.yaml | kubectl -n "$PROD_NS" apply -f -
        '''
      }
    }

    stage('Start Canary in PROD') {
      steps {
        sh '''
          set -euo pipefail
          # GREEN deployments with new images
          cat <<'YAML' | kubectl -n "$PROD_NS" apply -f -
          apiVersion: apps/v1
          kind: Deployment
          metadata: { name: backend-green, labels: { app: backend, version: green } }
          spec:
            replicas: 1
            selector: { matchLabels: { app: backend, version: green } }
            template:
              metadata: { labels: { app: backend, version: green } }
              spec:
                containers:
                - name: backend
                  image: "$BACKEND_IMAGE"
                  ports: [ { containerPort: 3000 } ]
                  env:
                  - { name: PORT, value: "3000" }
                  - { name: BASE_API_URL, value: "api" }
                  - name: MONGO_URI
                    valueFrom: { secretKeyRef: { name: app-secrets, key: MONGO_URI } }
                  - name: CLIENT_URL
                    valueFrom: { configMapKeyRef: { name: app-config, key: CLIENT_URL } }
          ---
          apiVersion: apps/v1
          kind: Deployment
          metadata: { name: frontend-green, labels: { app: frontend, version: green } }
          spec:
            replicas: 1
            selector: { matchLabels: { app: frontend, version: green } }
            template:
              metadata: { labels: { app: frontend, version: green } }
              spec:
                containers:
                - name: frontend
                  image: "$FRONTEND_IMAGE"
                  ports: [ { containerPort: 8080 } ]
                  env:
                  - name: API_URL
                    valueFrom: { configMapKeyRef: { name: app-config, key: API_URL } }
                  - { name: HOST, value: "0.0.0.0" }
                  - { name: PORT, value: "8080" }
          YAML

          # Canary services (select GREEN)
          kubectl -n "$PROD_NS" apply -f k8s/prod/22-backend-svc-canary.yaml
          kubectl -n "$PROD_NS" apply -f k8s/prod/32-frontend-svc-canary.yaml

          # Canary ingress with weight
          sed -e "s|__PROD_HOST__|$PROD_HOST|g" -e "s|__CANARY_WEIGHT__|$CANARY_WEIGHT|g" k8s/prod/45-ingress-canary.yaml | kubectl -n "$PROD_NS" apply -f -

          kubectl -n "$PROD_NS" rollout status deploy/backend-green --timeout=300s
          kubectl -n "$PROD_NS" rollout status deploy/frontend-green --timeout=300s
        '''
      }
    }

    stage('Validate Canary (PROD)') {
      steps {
        sh '''
          curl -fsS "$PROD_BASE_URL/" -I || true
          docker pull mcr.microsoft.com/playwright:v1.55.0-jammy
          docker run --rm --shm-size=1g -u $(id -u):$(id -g) \
            --add-host ${PROD_HOST}:${INGRESS_LB_IP} \
            -e HOME=/work -e NPM_CONFIG_CACHE=/work/.npm-cache \
            -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
            -e E2E_BASE_URL="${PROD_BASE_URL}" \
            -v "$PWD":/work -w /work \
            mcr.microsoft.com/playwright:v1.55.0-jammy \
            bash -lc 'mkdir -p .npm-cache && npm ci --no-audit --no-fund && npm run test:e2e'
        '''
      }
    }

    stage('Promote Canary to 100% (PROD)') {
      steps {
        sh '''
          set -euo pipefail
          # Switch stable Services to GREEN
          kubectl -n "$PROD_NS" patch svc backend-svc -p '{"spec":{"selector":{"app":"backend","version":"green"}}}'
          kubectl -n "$PROD_NS" patch svc frontend-svc -p '{"spec":{"selector":{"app":"frontend","version":"green"}}}'
          # Remove canary ingress
          kubectl -n "$PROD_NS" delete ingress app-ingress-canary --ignore-not-found=true
          # Optionally scale down BLUE
          kubectl -n "$PROD_NS" scale deploy backend --replicas=0 || true
          kubectl -n "$PROD_NS" scale deploy frontend --replicas=0 || true
        '''
      }
    }
  } // stages

  post {
    failure {
      echo "Deployment failed - attempting cleanup/rollback"
      sh '''
        kubectl -n "$PROD_NS" delete ingress app-ingress-canary --ignore-not-found=true
        kubectl -n "$PROD_NS" delete svc backend-svc-canary --ignore-not-found=true
        kubectl -n "$PROD_NS" delete svc frontend-svc-canary --ignore-not-found=true
        kubectl -n "$PROD_NS" delete deploy backend-green --ignore-not-found=true
        kubectl -n "$PROD_NS" delete deploy frontend-green --ignore-not-found=true
        kubectl -n "$PROD_NS" get deploy -o wide || true
      '''
      emailext(
        subject: "❌ FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
        to: '$DEFAULT_RECIPIENTS',
        body: '''
          <h2>Build Failed</h2>
          <p><b>Job:</b> ${env.JOB_NAME}<br/>
             <b>Build #:</b> ${env.BUILD_NUMBER}<br/>
             <b>Status:</b> ${currentBuild.currentResult}<br/>
             <b>Branch:</b> ${env.BRANCH_NAME ?: 'main'}</p>
          <p><a href="${env.BUILD_URL}">Open build</a></p>
        '''
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
