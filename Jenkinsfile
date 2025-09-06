pipeline {
  agent any

  options {
    timestamps()
    ansiColor('xterm')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  parameters {
    string(name: 'AWS_REGION',    defaultValue: 'us-east-1', description: 'AWS region')
    string(name: 'EKS_CLUSTER',   defaultValue: 'rmit-eks',  description: 'EKS cluster name')
    string(name: 'K8S_NAMESPACE', defaultValue: 'dev',       description: 'Kubernetes namespace')
    booleanParam(name: 'APPLY_MANIFESTS', defaultValue: false, description: 'Apply k8s/<namespace>/ manifests (first deploy)')
    booleanParam(name: 'SEED_DB',        defaultValue: false, description: 'Run seed job after deploy')
    string(name: 'BACKEND_REPO', defaultValue: 'rmit-store/backend', description: 'Backend repository')
    string(name: 'FRONTEND_REPO', defaultValue: 'rmit-store/frontend', description: 'Frontend repository')
    // Use Jenkins Credentials instead of plain strings:
    // Create a Jenkins credential ID "seed-admin" (Username = admin email, Password = admin password)
  }

  environment {
    REGION = "${params.AWS_REGION}"
    CLUSTER = "${params.EKS_CLUSTER}"
    NAMESPACE = "${params.K8S_NAMESPACE}"
    BACKEND_REPO = "${params.BACKEND_REPO}"
    FRONTEND_REPO = "${params.FRONTEND_REPO}"
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
        sh '''
          aws ecr get-login-password --region "$REGION" | \
            docker login --username AWS --password-stdin "$ECR"
        '''
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
              aws ecr create-repository \
                --region "$REGION" \
                --repository-name "$repo" \
                --image-scanning-configuration scanOnPush=true \
                --encryption-configuration encryptionType=AES256

              # Optional: keep only the last 10 images (best-effort; ignore if denied)
              aws ecr put-lifecycle-policy \
                --region "$REGION" \
                --repository-name "$repo" \
                --lifecycle-policy-text '{
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
      steps {
        sh '''
          docker build -f server/Dockerfile -t "$BACKEND_IMAGE" .
        '''
      }
    }

    stage('Build frontend image') {
      steps {
        sh '''
          docker build -f client/Dockerfile -t "$FRONTEND_IMAGE" .
        '''
      }
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
      steps {
        sh 'aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER"'
      }
    }

    stage('Backend: Unit + Integration tests') {
      agent { docker { image 'node:22' } }
      steps {
        dir('server') {
          sh 'npx jest --runInBand'
        }
      }
      post {
        always { junit allowEmptyResults: true, testResults: 'server/junit.xml' }
      }
    }

    stage('Apply k8s manifests (first time only)') {
      when { expression { return params.APPLY_MANIFESTS } }
      steps {
        sh '''
          # apply everything under k8s/<namespace> (your repo already has k8s/dev)
          if [ -d "k8s/$NAMESPACE" ]; then
            kubectl -n "$NAMESPACE" apply -f "k8s/$NAMESPACE"
          else
            echo "WARN: k8s/$NAMESPACE not found; skipping"
          fi
        '''
      }
    }

    stage('Deploy new images') {
      steps {
        sh '''
          # update Deployments to the freshly pushed images
          kubectl -n "$NAMESPACE" set image deploy/backend backend="$BACKEND_IMAGE"
          kubectl -n "$NAMESPACE" set image deploy/frontend frontend="$FRONTEND_IMAGE"

          # wait for rollouts (does NOT require kubectl exec/logs)
          kubectl -n "$NAMESPACE" rollout status deploy/backend --timeout=180s
          kubectl -n "$NAMESPACE" rollout status deploy/frontend --timeout=180s
        '''
      }
    }

    stage('Discover DEV_BASE_URL') {
      steps {
        script {
          // 1) Prefer the app Ingress host (if you set spec.rules.host)
          def ingHost = sh(script: """
            kubectl -n "$NAMESPACE" get ingress -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || true
          """, returnStdout: true).trim()

          // 2) Otherwise fallback to the ingress-nginx LB DNS
          def ctrlHost = sh(script: """
            kubectl -n ingress-nginx get svc ingress-nginx-controller \
              -o jsonpath='{.status.loadBalancer.ingress[0].hostname}{.status.loadBalancer.ingress[0].ip}'
          """, returnStdout: true).trim()

          // 3) Read the "http" port from the controller service (you changed it to 8080)
          def httpPort = sh(script: """
            kubectl -n ingress-nginx get svc ingress-nginx-controller \
              -o jsonpath='{.spec.ports[?(@.name=="http")].port}'
          """, returnStdout: true).trim()
          if (!httpPort) { httpPort = "80" }

          // Compose URL. Browsers can’t override Host, so if you have host-based rules,
          // you must use the actual host (ingHost). If you don’t have DNS, consider
          // removing host from the dev Ingress so any host matches.
          def host = ingHost ?: ctrlHost
          if (!host) { error "Could not determine Ingress host" }

          def base = (httpPort == "80") ? "http://${host}" : "http://${host}:${httpPort}"
          env.DEV_BASE_URL = base

          echo "DEV_BASE_URL resolved to: ${env.DEV_BASE_URL}"
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
            sed "s|__IMAGE__|$BACKEND_IMAGE|g" k8s/99-seed-db.yaml \
              | kubectl -n "$NAMESPACE" apply -f -

            # Wait for the Job to finish (don’t fail the whole pipeline if it times out)
            kubectl -n "$NAMESPACE" wait --for=condition=complete job/seed-db --timeout=180s || true

            # Optional: keep or delete the secret; delete means creds won’t linger in the cluster
            kubectl -n "$NAMESPACE" delete secret seed-admin --ignore-not-found=true
          '''
        }
      }
    }

    stage('Web UI E2E (Playwright)') {
      agent { docker { image 'mcr.microsoft.com/playwright:v1.47.0-jammy' } }
      environment {
        // still use the discovered base URL
        DEV_BASE_URL = "${env.DEV_BASE_URL}"
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'seed-admin',
                                          usernameVariable: 'E2E_EMAIL',
                                          passwordVariable: 'E2E_PASSWORD')]) {
          sh '''
            npx playwright install --with-deps
            # Optional quick sanity: verify login API works BEFORE UI runs
            node -e "
              (async () => {
                const res = await fetch(process.env.DEV_BASE_URL + '/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD })
                });
                console.log('Login HTTP:', res.status);
                if (res.status !== 200) process.exit(10);
              })().catch(e => { console.error(e); process.exit(11); });
            "
            npx playwright test --reporter=html
          '''
        }
      }
    }

    stage('Show endpoints') {
      steps {
        sh '''
          echo "=== Kubernetes objects ($NAMESPACE) ==="
          kubectl -n "$NAMESPACE" get deploy,svc,ingress -o wide || true

          echo "=== If using NGINX Ingress Service LB ==="
          kubectl -n ingress-nginx get svc ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}{"\\n"}' || true

          echo "You can test:   curl http://<ELB>/api/brand/list"
        '''
      }
    }

    stage('Promote to Prod') {
      when { expression { currentBuild.currentResult == 'SUCCESS' } }
      steps {
        echo 'All tests passed. Deploying to production...'
      }
    }
  }

  post {
    failure {
      echo "Deployment failed – attempting rollback"
      sh '''
        kubectl -n "$NAMESPACE" rollout undo deploy/backend || true
        kubectl -n "$NAMESPACE" rollout undo deploy/frontend || true
        kubectl -n "$NAMESPACE" get deploy -o wide || true
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
