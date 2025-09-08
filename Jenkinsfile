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
    booleanParam(name: 'APPLY_MANIFESTS', defaultValue: true, description: 'Apply k8s/<namespace>/ manifests (first deploy)')
    booleanParam(name: 'SEED_DB', defaultValue: true, description: 'Run seed job after deploy')
    string(name: 'PROD_NAMESPACE', defaultValue: 'prod', description: 'Kubernetes namespace for production')
    string(name: 'CANARY_WEIGHT', defaultValue: '10', description: 'Initial canary traffic weight (0-100)')
    booleanParam(name: 'APPLY_PROD_MANIFESTS', defaultValue: true, description: 'Apply k8s/prod manifests (first deploy to prod)')
    string(name: 'DEV_HOSTNAME',  defaultValue: 'dev.local',  description: 'Dev host used in Ingress')
    string(name: 'PROD_HOSTNAME', defaultValue: 'prod.local', description: 'Prod host used in Ingress/Canary')
    booleanParam(name: 'BOOTSTRAP_PROD_BLUE', defaultValue: true, description: 'Set blue (stable) images on first prod deployment')
  }

  environment {
    REGION = "${params.AWS_REGION}"
    CLUSTER = "${params.EKS_CLUSTER}"
    NAMESPACE = "${params.K8S_NAMESPACE}"
    BACKEND_REPO = "${params.BACKEND_REPO}"
    FRONTEND_REPO = "${params.FRONTEND_REPO}"
    PROD_NAMESPACE = "${params.PROD_NAMESPACE}"
    CANARY_WEIGHT = "${params.CANARY_WEIGHT}"
    DEV_HOSTNAME = "${params.DEV_HOSTNAME}"
    PROD_HOSTNAME = "${params.PROD_HOSTNAME}"
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

    stage('Deploy new images') {
      steps {
        sh '''
          # update Deployments to the freshly pushed images
          kubectl -n "$NAMESPACE" set image deploy/backend backend="$BACKEND_IMAGE"
          kubectl -n "$NAMESPACE" set image deploy/frontend frontend="$FRONTEND_IMAGE"

          # wait for rollouts
          kubectl -n "$NAMESPACE" rollout status deploy/backend --timeout=180s
          kubectl -n "$NAMESPACE" rollout status deploy/frontend --timeout=180s
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

    stage('Compute E2E_BASE_URL') {
      steps {
        script {
          def ep = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'", returnStdout: true).trim()
          if (!ep) {
            ep = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'", returnStdout: true).trim()
          }
          env.E2E_BASE_URL = "http://${params.DEV_HOSTNAME}:8080"
          echo "E2E_BASE_URL=${env.E2E_BASE_URL}"
        }
      }
    }

    stage('Compute Ingress LB host/IP') {
      steps {
        script {
          env.INGRESS_LB_HOST = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'", returnStdout: true).trim()
          // Try getent first, fall back to dig
          env.INGRESS_LB_IP = sh(
            script: "getent hosts ${env.INGRESS_LB_HOST} | awk '{print \$1}' | head -n1 || dig +short ${env.INGRESS_LB_HOST} | head -n1",
            returnStdout: true
          ).trim()
          echo "LB Host: ${env.INGRESS_LB_HOST}, LB IP: ${env.INGRESS_LB_IP}"
        }
      }
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

    stage('Web UI E2E (Playwright)') {
      steps {
        sh '''
          set -euo pipefail
          docker pull mcr.microsoft.com/playwright:v1.55.0-jammy
          docker run --rm \
            --shm-size=1g \
            -u $(id -u):$(id -g) \
            --add-host ${DEV_HOSTNAME}:${INGRESS_LB_IP} \
            -e HOME=/work \
            -e NPM_CONFIG_CACHE=/work/.npm-cache \
            -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
            -e E2E_BASE_URL="${E2E_BASE_URL}" \
            -v "$PWD":/work -w /work \
            mcr.microsoft.com/playwright:v1.55.0-jammy \
            bash -lc '
              mkdir -p .npm-cache
              npm ci --no-audit --no-fund
              npm run test:e2e
            '
        '''
      }
      post { always { archiveArtifacts artifacts: 'playwright-report/**', fingerprint: true } }
    }


    stage('Show endpoints') {
      steps { echo "You can test the website at: ${E2E_BASE_URL}" }
    }

    stage('Init Prod Manifests (first time only)') {
      when {
        allOf {
          expression { currentBuild.currentResult == 'SUCCESS' }
          expression { return params.APPLY_PROD_MANIFESTS }
        }
      }
      steps {
        sh '''
          set -euo pipefail
          kubectl apply -f k8s/prod/00-namespace.yaml
          kubectl -n "$PROD_NAMESPACE" apply -f k8s/prod/10-configmap.yaml
          kubectl -n "$PROD_NAMESPACE" apply -f k8s/prod/11-secret.yaml
          kubectl -n "$PROD_NAMESPACE" apply -f k8s/prod/20-backend-deploy.yaml
          kubectl -n "$PROD_NAMESPACE" apply -f k8s/prod/21-backend-svc.yaml
          kubectl -n "$PROD_NAMESPACE" apply -f k8s/prod/30-frontend-deploy.yaml
          kubectl -n "$PROD_NAMESPACE" apply -f k8s/prod/31-frontend-svc.yaml
        '''
      }
    }

    stage('Bootstrap Prod Blue Images (one time)') {
      when {
        allOf {
          expression { currentBuild.currentResult == 'SUCCESS' }
          expression { return params.BOOTSTRAP_PROD_BLUE }
        }
      }
      steps {
        sh '''
          set -euo pipefail
          kubectl -n "$PROD_NAMESPACE" set image deploy/backend backend="$BACKEND_IMAGE" --record
          kubectl -n "$PROD_NAMESPACE" set image deploy/frontend frontend="$FRONTEND_IMAGE" --record
          kubectl -n "$PROD_NAMESPACE" rollout status deploy/backend --timeout=180s
          kubectl -n "$PROD_NAMESPACE" rollout status deploy/frontend --timeout=180s
        '''
      }
    }

    stage('Compute PROD_HOST & PROD_BASE_URL') {
      when { expression { currentBuild.currentResult == 'SUCCESS' } }
      steps {
        script {
          def ep = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'", returnStdout: true).trim()
          if (!ep) {
            ep = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'", returnStdout: true).trim()
          }
          env.PROD_HOST = params.PROD_HOSTNAME                    // ✅ just the ELB hostname/IP
          env.PROD_BASE_URL = "http://${env.PROD_HOST}:8080"
          echo "PROD_BASE_URL=${env.PROD_BASE_URL}"
        }
      }
    }

    stage('Apply Prod Ingress (base)') {
      when { expression { currentBuild.currentResult == 'SUCCESS' } }
      steps {
        sh '''
          set -euo pipefail
          sed "s|__PROD_HOST__|$PROD_HOST|g" k8s/prod/40-ingress.yaml | kubectl -n "$PROD_NAMESPACE" apply -f -
          sed -e "s|__PROD_HOST__|$PROD_HOST|g" -e "s|__CANARY_WEIGHT__|$CANARY_WEIGHT|g" \
            k8s/prod/45-ingress-canary.yaml | kubectl -n "$PROD_NAMESPACE" apply -f -
        '''
      }
    }

    stage('Start Canary in PROD') {
      when { expression { currentBuild.currentResult == 'SUCCESS' } }
      steps {
        sh '''
          set -euo pipefail

          # GREEN deployments (new images)
          cat <<YAML | kubectl -n "$PROD_NAMESPACE" apply -f -
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
          kubectl -n "$PROD_NAMESPACE" apply -f k8s/prod/22-backend-svc-canary.yaml
          kubectl -n "$PROD_NAMESPACE" apply -f k8s/prod/32-frontend-svc-canary.yaml

          # Canary ingress (weight)
          sed -e "s|__PROD_HOST__|$PROD_HOST|g" -e "s|__CANARY_WEIGHT__|$CANARY_WEIGHT|g" \
            k8s/prod/45-ingress-canary.yaml | kubectl -n "$PROD_NAMESPACE" apply -f -

          kubectl -n "$PROD_NAMESPACE" rollout status deploy/backend-green --timeout=300s
          kubectl -n "$PROD_NAMESPACE" rollout status deploy/frontend-green --timeout=300s
        '''
      }
    }

    stage('Validate Canary (Prod)') {
      when { expression { currentBuild.currentResult == 'SUCCESS' } }
      steps {
        sh 'curl -fsS -H "Host: ${PROD_HOST}" "http://${INGRESS_LB_HOST}:8080/" -I || true'
        sh '''
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

    stage('Promote Canary to 100% (Prod)') {
      when { expression { currentBuild.currentResult == 'SUCCESS' } }
      steps {
        sh '''
          set -euo pipefail
          # Switch stable Services to GREEN
          kubectl -n "$PROD_NAMESPACE" patch svc backend-svc -p '{"spec":{"selector":{"app":"backend","version":"green"}}}'
          kubectl -n "$PROD_NAMESPACE" patch svc frontend-svc -p '{"spec":{"selector":{"app":"frontend","version":"green"}}}'
          # Remove canary ingress
          kubectl -n "$PROD_NAMESPACE" delete ingress app-ingress-canary --ignore-not-found=true
          # Optionally scale down BLUE
          kubectl -n "$PROD_NAMESPACE" scale deploy backend --replicas=0 || true
          kubectl -n "$PROD_NAMESPACE" scale deploy frontend --replicas=0 || true
        '''
      }
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
        kubectl -n "$PROD_NAMESPACE" delete ingress app-ingress-canary --ignore-not-found=true
        kubectl -n "$PROD_NAMESPACE" delete svc backend-svc-canary --ignore-not-found=true
        kubectl -n "$PROD_NAMESPACE" delete svc frontend-svc-canary --ignore-not-found=true
        kubectl -n "$PROD_NAMESPACE" delete deploy backend-green --ignore-not-found=true
        kubectl -n "$PROD_NAMESPACE" delete deploy frontend-green --ignore-not-found=true
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
